import type { Node } from "prosemirror-model"
import { findMatchOffset } from "~/lib/text/find"
import { neutralizeMarkdown } from "~/lib/text/mark"
import { splitBySentences } from "~/lib/text/split"
import { proseTextContent, textOffsetToPos } from "~/lib/editor/text"
import { alignSentences } from "./align"
import type { RenderableRegion } from "./types"

export interface ResolvedRegion {
  region: RenderableRegion
  from: number
  to: number
  labelFrom: number
  labelTo: number
}

const ANNOTATION_MARKER_SIDE = -1

export const iconSides = (resolved: readonly ResolvedRegion[]): number[] => {
  const lastOrder = resolved.reduce((max, r) => Math.max(max, r.region.kindOrder), 0)
  return resolved.map((r) => ANNOTATION_MARKER_SIDE - 1 - (lastOrder - r.region.kindOrder))
}

interface EditorRow {
  text: string
  start: number
  end: number
}

const splitEditorSentences = splitBySentences()

const editorSentences = (text: string): EditorRow[] =>
  splitEditorSentences(text).filter((row) => row.text.trim().length > 0)

type Alignment = (number | null)[]

const firstRowFrom = (aligned: Alignment, start: number, end: number): number | null => {
  for (let i = Math.max(0, start); i <= Math.min(end, aligned.length - 1); i++) {
    const row = aligned[i]
    if (row !== null) return row
  }
  return null
}

const lastRowUntil = (aligned: Alignment, start: number, end: number): number | null => {
  for (let i = Math.min(end, aligned.length - 1); i >= Math.max(0, start); i--) {
    const row = aligned[i]
    if (row !== null) return row
  }
  return null
}

// A stored quote is a run of the document's own characters, so it can carry the syntax of
// a construct it straddles. The editor renders that syntax away, and neutralizing the same
// span of the source sentence is what leaves both sides holding the same words.
const editorQuote = (source: string | undefined, quote: string): string => {
  if (source === undefined) return quote
  const at = source.indexOf(quote)
  return at === -1 ? quote : neutralizeMarkdown(source).slice(at, at + quote.length)
}

const toResolvedRegion = (
  doc: Node,
  rows: EditorRow[],
  aligned: Alignment,
  sentences: readonly string[],
  region: RenderableRegion
): ResolvedRegion | null => {
  const hitRow = aligned[region.hitSentence]
  if (hitRow === undefined || hitRow === null) return null

  const startRow = firstRowFrom(aligned, region.startSentence, region.endSentence)
  const endRow = lastRowUntil(aligned, region.startSentence, region.endSentence)
  if (startRow === null || endRow === null) return null

  const hit = rows[hitRow]
  const quote = findMatchOffset(hit.text, editorQuote(sentences[region.hitSentence], region.quote))
  if (!quote) return null

  return {
    region,
    from: textOffsetToPos(doc, rows[startRow].start),
    to: textOffsetToPos(doc, rows[endRow].end),
    labelFrom: textOffsetToPos(doc, hit.start + quote.start),
    labelTo: textOffsetToPos(doc, hit.start + quote.end),
  }
}

export const resolveRegions = (
  doc: Node,
  sentences: readonly string[],
  regions: readonly RenderableRegion[]
): ResolvedRegion[] => {
  if (regions.length === 0) return []
  const rows = editorSentences(proseTextContent(doc))
  const aligned = alignSentences(
    sentences,
    rows.map((row) => row.text)
  )
  return regions.flatMap((region) => {
    const resolved = toResolvedRegion(doc, rows, aligned, sentences, region)
    return resolved ? [resolved] : []
  })
}
