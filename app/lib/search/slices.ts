import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { getBlock } from "~/lib/data-blocks/query"
import { stripBlocksByLanguage, extractProse } from "~/lib/data-blocks/parse"
import { findMatchOffset } from "~/lib/text/find"
import { trimAroundMatches } from "~/lib/text/trim-around"
import { createCappedCache } from "~/lib/utils/cache"
import { yieldToBrowser } from "~/lib/utils/async"
import { selectVisibleAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import { getSelectedCodes } from "~/domain/data-blocks/ux/selectors"
import { SETTINGS_FILE } from "~/lib/files/filename"

const parseAnnotations = (fileContent: string): Annotation[] =>
  getBlock(fileContent, "json-annotations", AnnotationsBlockSchema)?.annotations ?? []

const formatAnnotationsBlock = (annotations: Annotation[]): string =>
  "```json-annotations\n" + JSON.stringify({ annotations }) + "\n```"

interface FileContext {
  prose: string
  annotations: Annotation[]
}

const computeFileContext = (fileContent: string): FileContext => ({
  prose: extractProse(fileContent),
  annotations: parseAnnotations(fileContent),
})

const resolveAnchors = (hit: SearchHit, annotations: Annotation[]): string[] | null => {
  if (hit.matches && hit.matches.length > 0) return hit.matches
  if (hit.id) {
    const match = annotations.find((a) => a.id === hit.id)
    if (match) return [match.text]
  }
  return null
}

const isInSlice = (slice: string, annotationText: string): boolean =>
  findMatchOffset(slice, annotationText) !== null

const stripLonelyEllipses = (text: string): string =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "…")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "")

const extractSliceFromContext = (
  hit: SearchHit,
  fileContent: string,
  ctx: FileContext,
  selectedCodes: Set<string>
): string | null => {
  const anchors = resolveAnchors(hit, ctx.annotations)
  if (!anchors) return null
  if (!fileContent) return hit.text ?? null

  const trimmed = stripLonelyEllipses(trimAroundMatches(ctx.prose, anchors))

  const visible = selectVisibleAnnotations(ctx.annotations, selectedCodes)
  const candidates = hit.id ? visible.filter((a) => a.id === hit.id) : visible
  const present = candidates.filter((a) => isInSlice(trimmed, a.text))
  if (present.length === 0) return trimmed
  return `${trimmed}\n\n${formatAnnotationsBlock(present)}`
}

const EMPTY_CODES = new Set<string>()

export const extractSearchSlice = (hit: SearchHit, fileContent: string): string | null =>
  extractSliceFromContext(hit, fileContent, computeFileContext(fileContent), EMPTY_CODES)

const growHitWithContext = (
  hit: SearchHit,
  fileContent: string,
  ctx: FileContext,
  selectedCodes: Set<string>
): SearchHit => {
  const grown = extractSliceFromContext(hit, fileContent, ctx, selectedCodes)
  if (!grown || grown === hit.text) return hit
  return { ...hit, text: grown }
}

const stripAnnotationsBlock = (raw: string): string =>
  stripBlocksByLanguage(raw, "json-annotations")

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

export const growHits = (hits: SearchHit[], files: FileStore): SearchHit[] => {
  const selectedCodes = getSelectedCodes(files)
  return deduplicateHits(
    hits.map((hit) => {
      const ctx = getFileContext(hit.file, files)
      if (!ctx) return hit
      return growHitWithContext(hit, files[hit.file], ctx, selectedCodes)
    })
  )
}

const isHitAlive = (hit: SearchHit, files: FileStore): boolean => {
  const content = files[hit.file]
  if (content === undefined) return false
  if (hit.id === undefined) return true
  return content.includes(hit.id)
}

const regrowHitWithContext = (
  hit: SearchHit,
  fileContent: string,
  ctx: FileContext,
  selectedCodes: Set<string>
): SearchHit => {
  if (!hit.text) return hit
  const stripped = stripAnnotationsBlock(hit.text)
  const grown = extractSliceFromContext({ ...hit, text: stripped }, fileContent, ctx, selectedCodes)
  if (!grown || grown === hit.text) return hit
  return { ...hit, text: grown }
}

const isHitFileUnchanged = (
  hit: SearchHit,
  files: FileStore,
  prevFiles: FileStore | undefined,
  settingsChanged: boolean
): boolean => !settingsChanged && !!prevFiles && prevFiles[hit.file] === files[hit.file]

export const refreshHits = (
  hits: SearchHit[],
  files: FileStore,
  prevFiles?: FileStore
): SearchHit[] => {
  const selectedCodes = getSelectedCodes(files)
  const settingsChanged = !!prevFiles && prevFiles[SETTINGS_FILE] !== files[SETTINGS_FILE]
  const refreshed: SearchHit[] = []
  for (const h of hits) {
    if (!isHitAlive(h, files)) continue
    if (isHitFileUnchanged(h, files, prevFiles, settingsChanged)) {
      refreshed.push(h)
      continue
    }
    const ctx = getFileContext(h.file, files)
    refreshed.push(ctx ? regrowHitWithContext(h, files[h.file], ctx, selectedCodes) : h)
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
  const selectedCodes = getSelectedCodes(files)
  const settingsChanged = !!prevFiles && prevFiles[SETTINGS_FILE] !== files[SETTINGS_FILE]
  const refreshed: SearchHit[] = []

  for (const h of hits) {
    if (isCancelled()) return refreshed
    if (!isHitAlive(h, files)) continue
    if (isHitFileUnchanged(h, files, prevFiles, settingsChanged)) {
      refreshed.push(h)
      continue
    }
    const ctx = getFileContext(h.file, files)
    refreshed.push(ctx ? regrowHitWithContext(h, files[h.file], ctx, selectedCodes) : h)
    await yieldToBrowser()
  }

  const deduped = deduplicateHits(refreshed)
  return sameRefs(deduped, hits) ? hits : deduped
}
