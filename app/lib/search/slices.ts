import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { getBlock } from "~/lib/data-blocks/query"
import { stripBlocksByLanguage, extractProse } from "~/lib/data-blocks/parse"
import { findMatchOffset } from "~/lib/text/find"
import { trimAroundMatches } from "~/lib/text/trim-around"
import { splitBySentences } from "~/lib/text/split"

interface Range {
  start: number
  end: number
}

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

const splitSentenceSegments = splitBySentences()

const locateExact = (prose: string, text: string): Range | null => {
  const idx = prose.indexOf(text)
  if (idx !== -1) return { start: idx, end: idx + text.length }
  return findMatchOffset(prose, text, true)
}

const edgeSentences = (text: string): [string, string] | [string] | null => {
  const segments = splitSentenceSegments(text)
  if (segments.length === 0) return null
  if (segments.length === 1) return [segments[0].text]
  return [segments[0].text, segments[segments.length - 1].text]
}

const locateEdgesInProse = (prose: string, text: string): Range | null => {
  const exact = locateExact(prose, text)
  if (exact) return exact
  const edges = edgeSentences(text)
  if (!edges) return null
  const first = locateExact(prose, edges[0])
  if (!first) return null
  if (edges.length === 1) return first
  const last = locateExact(prose, edges[1])
  if (!last) return null
  return { start: Math.min(first.start, last.start), end: Math.max(first.end, last.end) }
}

const rangesOverlap = (a: Range, b: Range): boolean => a.start < b.end && b.start < a.end

const hasFooting = (ann: Annotation, prose: string, trimmedRange: Range): boolean => {
  const annEdges = edgeSentences(ann.text)
  if (!annEdges) return false
  const proseSlice = prose.slice(trimmedRange.start, trimmedRange.end)
  const hasEdge = annEdges.some((s) => findMatchOffset(proseSlice, s, true) !== null)
  if (!hasEdge) return false
  const annRange = locateExact(prose, ann.text) ?? findMatchOffset(prose, ann.text)
  if (!annRange) return false
  return rangesOverlap(annRange, trimmedRange)
}

const findFootedAnnotations = (
  trimmedProse: string,
  prose: string,
  annotations: Annotation[],
  entityId?: string
): Annotation[] => {
  const candidates = entityId ? annotations.filter((a) => a.id === entityId) : annotations

  const trimmedRange = locateEdgesInProse(prose, trimmedProse)
  if (!trimmedRange) return []

  return candidates.filter((ann) => hasFooting(ann, prose, trimmedRange))
}

const expandToAnnotations = (
  prose: string,
  trimmedProse: string,
  annotations: Annotation[]
): string => {
  if (annotations.length === 0) return trimmedProse

  const trimmedRange = locateEdgesInProse(prose, trimmedProse)
  if (!trimmedRange) return trimmedProse

  let start = trimmedRange.start
  let end = trimmedRange.end

  for (const ann of annotations) {
    const annRange = locateExact(prose, ann.text) ?? findMatchOffset(prose, ann.text)
    if (!annRange) continue
    if (annRange.start < start) start = annRange.start
    if (annRange.end > end) end = annRange.end
  }

  return prose.slice(start, end)
}

const extractSliceFromContext = (
  hit: SearchHit,
  fileContent: string,
  ctx: FileContext
): string | null => {
  const anchors = resolveAnchors(hit, ctx.annotations)
  if (!anchors) return null
  if (!fileContent) return hit.text ?? null

  const trimmed = trimAroundMatches(ctx.prose, anchors)

  if (ctx.annotations.length === 0) return trimmed

  const footed = findFootedAnnotations(trimmed, ctx.prose, ctx.annotations, hit.id)
  if (footed.length === 0) return trimmed

  const expanded = expandToAnnotations(ctx.prose, trimmed, footed)
  return `${expanded}\n\n${formatAnnotationsBlock(footed)}`
}

export const extractSearchSlice = (hit: SearchHit, fileContent: string): string | null =>
  extractSliceFromContext(hit, fileContent, computeFileContext(fileContent))

const growHitWithContext = (hit: SearchHit, fileContent: string, ctx: FileContext): SearchHit => {
  const grown = extractSliceFromContext(hit, fileContent, ctx)
  if (!grown) return hit
  return { ...hit, text: grown }
}

const stripAnnotationsBlock = (raw: string): string =>
  stripBlocksByLanguage(raw, "json-annotations")

const hitDedupeKey = (hit: SearchHit): string | null =>
  hit.text ? `${hit.file}\0${stripAnnotationsBlock(hit.text)}` : null

const deduplicateHits = (hits: SearchHit[]): SearchHit[] => {
  const seen = new Set<string>()
  return hits.filter((hit) => {
    const key = hitDedupeKey(hit)
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const getFileContext = (
  file: string,
  files: FileStore,
  cache: Map<string, FileContext>
): FileContext | null => {
  const content = files[file]
  if (!content) return null
  const cached = cache.get(file)
  if (cached) return cached
  const ctx = computeFileContext(content)
  cache.set(file, ctx)
  return ctx
}

export const growHits = (hits: SearchHit[], files: FileStore): SearchHit[] => {
  const cache = new Map<string, FileContext>()
  return deduplicateHits(
    hits.map((hit) => {
      const ctx = getFileContext(hit.file, files, cache)
      if (!ctx) return hit
      return growHitWithContext(hit, files[hit.file], ctx)
    })
  )
}

const isHitAlive = (hit: SearchHit, files: FileStore): boolean => {
  const content = files[hit.file]
  if (content === undefined) return false
  if (hit.id === undefined) return true
  return content.includes(hit.id)
}

const regrowHitWithContext = (hit: SearchHit, fileContent: string, ctx: FileContext): SearchHit => {
  if (!hit.text) return hit
  return growHitWithContext({ ...hit, text: stripAnnotationsBlock(hit.text) }, fileContent, ctx)
}

export const refreshHits = (hits: SearchHit[], files: FileStore): SearchHit[] => {
  const cache = new Map<string, FileContext>()
  return deduplicateHits(
    hits
      .filter((h) => isHitAlive(h, files))
      .map((h) => {
        const ctx = getFileContext(h.file, files, cache)
        if (!ctx) return h
        return regrowHitWithContext(h, files[h.file], ctx)
      })
  )
}
