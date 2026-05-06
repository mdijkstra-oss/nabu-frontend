import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { getBlock } from "~/lib/data-blocks/query"
import { stripAttributesBlock } from "~/lib/markdown/strip-attributes"
import { stripBlocksByLanguage } from "~/lib/data-blocks/parse"

interface Range {
  start: number
  end: number
}

interface ExpandedSlice {
  text: string
  annotations: Annotation[]
}

const stripMarks = (text: string): string => text.replace(/<\/?mark>/g, "")

const findRange = (haystack: string, needle: string): Range | null => {
  const idx = haystack.indexOf(needle)
  if (idx === -1) return null
  return { start: idx, end: idx + needle.length }
}

const rangesOverlap = (a: Range, b: Range): boolean => a.start < b.end && b.start < a.end

const boundingRange = (base: Range, extras: Range[]): Range => {
  let start = base.start
  let end = base.end
  for (const r of extras) {
    if (r.start < start) start = r.start
    if (r.end > end) end = r.end
  }
  return { start, end }
}

const parseAnnotations = (fileContent: string): Annotation[] =>
  getBlock(fileContent, "json-annotations", AnnotationsBlockSchema)?.annotations ?? []

const formatAnnotationsBlock = (annotations: Annotation[]): string =>
  "```json-annotations\n" + JSON.stringify({ annotations }) + "\n```"

const expandSliceWithAnnotations = (
  sliceText: string,
  prose: string,
  annotations: Annotation[]
): ExpandedSlice => {
  const cleanSlice = stripMarks(sliceText)
  const sliceRange = findRange(prose, cleanSlice)
  if (!sliceRange) return { text: sliceText, annotations: [] }
  if (annotations.length === 0) return { text: sliceText, annotations: [] }

  const overlapping: { annotation: Annotation; range: Range }[] = []
  for (const ann of annotations) {
    const annRange = findRange(prose, ann.text)
    if (!annRange) continue
    if (rangesOverlap(sliceRange, annRange)) {
      overlapping.push({ annotation: ann, range: annRange })
    }
  }

  if (overlapping.length === 0) return { text: sliceText, annotations: [] }

  const expanded = boundingRange(
    sliceRange,
    overlapping.map((o) => o.range)
  )
  return {
    text: prose.slice(expanded.start, expanded.end),
    annotations: overlapping.map((o) => o.annotation),
  }
}

export const extractSearchSlice = (hit: SearchHit, fileContent: string): string | null => {
  if (!hit.text) return null
  if (!fileContent) return hit.text

  const annotations = parseAnnotations(fileContent)
  if (annotations.length === 0) return hit.text

  const prose = stripAttributesBlock(fileContent)
  const { text, annotations: overlapping } = expandSliceWithAnnotations(
    hit.text,
    prose,
    annotations
  )
  if (overlapping.length === 0) return text

  return `${text}\n\n${formatAnnotationsBlock(overlapping)}`
}

const growHit = (hit: SearchHit, files: FileStore): SearchHit => {
  if (!hit.text) return hit
  const fileContent = files[hit.file]
  if (!fileContent) return hit
  const grown = extractSearchSlice(hit, fileContent)
  if (!grown) return hit
  return { ...hit, text: grown }
}

export const growHits = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  hits.map((hit) => growHit(hit, files))

const stripAnnotationsBlock = (raw: string): string =>
  stripBlocksByLanguage(raw, "json-annotations")

const isHitAlive = (hit: SearchHit, files: FileStore): boolean => {
  const content = files[hit.file]
  if (content === undefined) return false
  if (hit.id === undefined) return true
  return content.includes(hit.id)
}

const regrowHit = (hit: SearchHit, files: FileStore): SearchHit => {
  if (!hit.text) return hit
  return growHit({ ...hit, text: stripAnnotationsBlock(hit.text) }, files)
}

export const refreshHits = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  hits.filter((h) => isHitAlive(h, files)).map((h) => regrowHit(h, files))
