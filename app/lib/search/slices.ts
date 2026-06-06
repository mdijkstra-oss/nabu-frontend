import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { getBlock } from "~/lib/data-blocks/query"
import { stripBlocksByLanguage, extractProse } from "~/lib/data-blocks/parse"
import { findOwningChunk, growToInclude } from "~/lib/text/find"
import { trimAroundMatches, SEPARATOR } from "~/lib/text/trim-around"
import { createCappedCache } from "~/lib/utils/cache"
import { yieldToBrowser } from "~/lib/utils/async"
import { selectVisibleAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import { getSelectedCodes } from "~/domain/data-blocks/ux/selectors"
import { SETTINGS_FILE } from "~/lib/files/filename"

const MIN_OWNED_WORDS = 3

const parseAnnotations = (fileContent: string): Annotation[] =>
  getBlock(fileContent, "json-annotations", AnnotationsBlockSchema)?.annotations ?? []

const formatAnnotationsBlock = (annotations: Annotation[]): string =>
  "```json-annotations\n" + JSON.stringify({ annotations }) + "\n```"

const stripAnnotationsBlock = (raw: string): string =>
  stripBlocksByLanguage(raw, "json-annotations")

interface FileContext {
  prose: string
  annotations: Annotation[]
}

const computeFileContext = (fileContent: string): FileContext => ({
  prose: extractProse(fileContent),
  annotations: parseAnnotations(fileContent),
})

const fileContextCache = createCappedCache<string, FileContext>(500)

const getFileContext = (file: string, files: FileStore): FileContext | null => {
  const content = files[file]
  if (!content) return null
  const cached = fileContextCache.get(content)
  if (cached) return cached
  const ctx = computeFileContext(content)
  fileContextCache.set(content, ctx)
  return ctx
}

const stripLonelyEllipses = (text: string): string =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "…")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "")

const resolveAnchors = (hit: SearchHit, annotations: Annotation[]): string[] | null => {
  if (hit.matches && hit.matches.length > 0) return hit.matches
  if (hit.id) {
    const match = annotations.find((a) => a.id === hit.id)
    if (match) return [match.text]
  }
  return null
}

type NormalizeMode = "trim" | "raw"

interface Region {
  hit: SearchHit
  text: string
}

const normalizeToRegions = (hit: SearchHit, ctx: FileContext, mode: NormalizeMode): Region[] => {
  if (mode === "raw") {
    return hit.text ? [{ hit, text: hit.text }] : []
  }
  const anchors = resolveAnchors(hit, ctx.annotations)
  if (!anchors) return hit.text ? [{ hit, text: hit.text }] : []
  const trimmed = stripLonelyEllipses(trimAroundMatches(ctx.prose, anchors))
  if (!trimmed) return hit.text ? [{ hit, text: hit.text }] : []
  const parts = trimmed
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) return []
  return parts.map((text) => ({ hit, text }))
}

const mapOwners = (regions: Region[], visible: Annotation[]): Map<Region, Annotation[]> => {
  const owned = new Map<Region, Annotation[]>()
  for (const ann of visible) {
    const candidates = regions.filter((r) => !r.hit.id || r.hit.id === ann.id)
    if (candidates.length === 0) continue
    const owner = findOwningChunk(candidates, ann.text, { minWords: MIN_OWNED_WORDS })
    if (!owner) continue
    const list = owned.get(owner) ?? []
    list.push(ann)
    owned.set(owner, list)
  }
  return owned
}

const attachToRegion = (region: Region, anns: Annotation[]): SearchHit => {
  let text = region.text
  for (const ann of anns) text = growToInclude(text, ann.text)
  if (anns.length > 0) text = `${text}\n\n${formatAnnotationsBlock(anns)}`
  return { ...region.hit, text }
}

const groupByFile = (hits: SearchHit[]): Map<string, SearchHit[]> => {
  const groups = new Map<string, SearchHit[]>()
  for (const hit of hits) {
    const list = groups.get(hit.file) ?? []
    list.push(hit)
    groups.set(hit.file, list)
  }
  return groups
}

const hitDedupeKey = (hit: SearchHit): string | null =>
  hit.text ? `${hit.file}\0${stripAnnotationsBlock(hit.text)}` : null

const sameRefs = (a: SearchHit[], b: SearchHit[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

const deduplicateHits = (hits: SearchHit[]): SearchHit[] => {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  let dropped = false
  for (const hit of hits) {
    const key = hitDedupeKey(hit)
    if (key === null) {
      out.push(hit)
      continue
    }
    if (seen.has(key)) {
      dropped = true
      continue
    }
    seen.add(key)
    out.push(hit)
  }
  return dropped ? out : hits
}

const attachAnnotationsWithMode = (
  hits: SearchHit[],
  files: FileStore,
  mode: NormalizeMode
): SearchHit[] => {
  const selectedCodes = getSelectedCodes(files)
  const fileGroups = groupByFile(hits)
  const out: SearchHit[] = []

  for (const [, fileHits] of fileGroups) {
    const file = fileHits[0].file
    const ctx = getFileContext(file, files)
    if (!ctx) {
      out.push(...fileHits)
      continue
    }
    const regions: Region[] = []
    const passThrough: SearchHit[] = []
    for (const hit of fileHits) {
      const hitRegions = normalizeToRegions(hit, ctx, mode)
      if (hitRegions.length === 0) {
        passThrough.push(hit)
        continue
      }
      regions.push(...hitRegions)
    }
    const visible = selectVisibleAnnotations(ctx.annotations, selectedCodes)
    const ownerMap = mapOwners(regions, visible)
    for (const region of regions) {
      const anns = ownerMap.get(region) ?? []
      out.push(attachToRegion(region, anns))
    }
    out.push(...passThrough)
  }

  return deduplicateHits(out)
}

export const growHits = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  attachAnnotationsWithMode(hits, files, "trim")

export const attachAnnotationsOnly = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  attachAnnotationsWithMode(hits, files, "raw")

const inferMode = (hit: SearchHit): NormalizeMode =>
  (hit.matches && hit.matches.length > 0) || hit.id ? "trim" : "raw"

const isHitAlive = (hit: SearchHit, files: FileStore): boolean => {
  const content = files[hit.file]
  if (content === undefined) return false
  if (hit.id === undefined) return true
  return content.includes(hit.id)
}

const isHitFileUnchanged = (
  hit: SearchHit,
  files: FileStore,
  prevFiles: FileStore | undefined,
  settingsChanged: boolean
): boolean => !settingsChanged && !!prevFiles && prevFiles[hit.file] === files[hit.file]

const refreshHit = (hit: SearchHit, files: FileStore): SearchHit[] => {
  const stripped = hit.text ? { ...hit, text: stripAnnotationsBlock(hit.text) } : hit
  return attachAnnotationsWithMode([stripped], files, inferMode(stripped))
}

export const refreshHits = (
  hits: SearchHit[],
  files: FileStore,
  prevFiles?: FileStore
): SearchHit[] => {
  const settingsChanged = !!prevFiles && prevFiles[SETTINGS_FILE] !== files[SETTINGS_FILE]
  const refreshed: SearchHit[] = []
  for (const h of hits) {
    if (!isHitAlive(h, files)) continue
    if (isHitFileUnchanged(h, files, prevFiles, settingsChanged)) {
      refreshed.push(h)
      continue
    }
    refreshed.push(...refreshHit(h, files))
  }
  const deduped = deduplicateHits(refreshed)
  return sameRefs(deduped, hits) ? hits : deduped
}

export const refreshHitsAsync = async (
  hits: SearchHit[],
  files: FileStore,
  isCancelled: () => boolean,
  prevFiles?: FileStore
): Promise<SearchHit[]> => {
  const settingsChanged = !!prevFiles && prevFiles[SETTINGS_FILE] !== files[SETTINGS_FILE]
  const refreshed: SearchHit[] = []
  for (const h of hits) {
    if (isCancelled()) return refreshed
    if (!isHitAlive(h, files)) continue
    if (isHitFileUnchanged(h, files, prevFiles, settingsChanged)) {
      refreshed.push(h)
      continue
    }
    refreshed.push(...refreshHit(h, files))
    await yieldToBrowser()
  }
  const deduped = deduplicateHits(refreshed)
  return sameRefs(deduped, hits) ? hits : deduped
}
