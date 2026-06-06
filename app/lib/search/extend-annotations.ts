import type { SearchHit } from "~/domain/search/types"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import type { FileStore } from "~/lib/files/store"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { getBlock } from "~/lib/data-blocks/query"
import { findMatchOffset } from "~/lib/text/find"
import { selectVisibleAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import { getSelectedCodes } from "~/domain/data-blocks/ux/selectors"
import { getEmbeddableSource } from "./source"

interface ByteRange {
  start: number
  end: number
}

const overlaps = (a: ByteRange, b: ByteRange): boolean => a.start < b.end && a.end > b.start

const parseAnnotations = (content: string): Annotation[] =>
  getBlock(content, "json-annotations", AnnotationsBlockSchema)?.annotations ?? []

const fileAnnotations = (file: string, files: FileStore): Annotation[] => {
  const content = files[file]
  if (!content) return []
  return parseAnnotations(content)
}

interface ExtendResult {
  range: ByteRange
  included: Annotation[]
}

const formatAnnotationsBlock = (annotations: Annotation[]): string =>
  "```json-annotations\n" + JSON.stringify({ annotations }) + "\n```"

export const extendAndCollect = (
  range: ByteRange,
  annotations: Annotation[],
  source: string
): ExtendResult => {
  const resolved: { ann: Annotation; offset: ByteRange }[] = []
  for (const ann of annotations) {
    const offset = findMatchOffset(source, ann.text)
    if (offset) resolved.push({ ann, offset })
  }
  let { start, end } = range
  for (const { offset } of resolved) {
    if (overlaps(offset, { start, end })) {
      start = Math.min(start, offset.start)
      end = Math.max(end, offset.end)
    }
  }
  const extended = { start, end }
  const included = resolved.filter(({ offset }) => overlaps(offset, extended)).map(({ ann }) => ann)
  return { range: extended, included }
}

export const extendRangeForAnnotations = (
  range: ByteRange,
  annotations: Annotation[],
  source: string
): ByteRange => extendAndCollect(range, annotations, source).range

export const extendRegionsForAnnotations = (hits: SearchHit[], files: FileStore): SearchHit[] => {
  const selectedCodes = getSelectedCodes(files)
  const annotationCache = new Map<string, Annotation[]>()
  const sourceCache = new Map<string, string | null>()

  const getAnnotations = (file: string): Annotation[] => {
    const cached = annotationCache.get(file)
    if (cached !== undefined) return cached
    const visible = selectVisibleAnnotations(fileAnnotations(file, files), selectedCodes)
    annotationCache.set(file, visible)
    return visible
  }

  const getSource = (file: string): string | null => {
    const cached = sourceCache.get(file)
    if (cached !== undefined) return cached
    const source = getEmbeddableSource(file, files)
    sourceCache.set(file, source)
    return source
  }

  return hits.map((hit) => {
    if (hit.chunkStart === undefined || hit.chunkEnd === undefined) return hit
    const annotations = getAnnotations(hit.file)
    if (annotations.length === 0) return hit
    const source = getSource(hit.file)
    if (source === null) return hit
    const { range: extended, included } = extendAndCollect(
      { start: hit.chunkStart, end: hit.chunkEnd },
      annotations,
      source
    )
    const rangeUnchanged = extended.start === hit.chunkStart && extended.end === hit.chunkEnd
    if (rangeUnchanged && included.length === 0) return hit
    const baseText = source.slice(extended.start, extended.end)
    const text =
      included.length > 0 ? `${baseText}\n\n${formatAnnotationsBlock(included)}` : baseText
    return {
      ...hit,
      chunkStart: extended.start,
      chunkEnd: extended.end,
      text,
    }
  })
}
