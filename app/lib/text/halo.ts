import { splitMarkdownBySentences } from "~/lib/text/split"
import { extractProse } from "~/lib/data-blocks/parse"

export interface SentenceRow {
  text: string
  start: number
  end: number
}

export interface HaloResult {
  haloSentences: string[]
  markedStart: number
  markedEnd: number
  fileCharStart: number
  fileCharEnd: number
  haloCharStart: number
  haloCharEnd: number
}

const splitSentencesWithOffsets = splitMarkdownBySentences()

// Fenced blocks are cut out first and nothing else is removed, so a sentence row, an
// embedding chunk and a search hit all measure offsets in one string. Writing a
// json-regions or json-embeddings block into a document therefore moves no index.
export const proseOf = (rawFile: string): string => extractProse(rawFile)

export const indexProseSentences = (prose: string): SentenceRow[] =>
  splitSentencesWithOffsets(prose).map((s) => ({ text: s.text, start: s.start, end: s.end }))

export const indexFileSentences = (rawFile: string): SentenceRow[] =>
  indexProseSentences(proseOf(rawFile))

export const findOverlappingRange = (
  rows: readonly SentenceRow[],
  charStart: number,
  charEnd: number
): { firstIdx: number; lastIdx: number } | null => {
  let firstIdx = -1
  let lastIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.end <= charStart) continue
    if (r.start >= charEnd) break
    if (firstIdx === -1) firstIdx = i
    lastIdx = i
  }
  return firstIdx === -1 ? null : { firstIdx, lastIdx }
}

export const buildHaloForRows = (
  rows: readonly SentenceRow[],
  charStart: number,
  charEnd: number,
  haloSentenceCount: number
): HaloResult | null => {
  if (rows.length === 0) return null

  const overlap = findOverlappingRange(rows, charStart, charEnd)
  if (!overlap) return null

  const haloStart = Math.max(0, overlap.firstIdx - haloSentenceCount)
  const haloEnd = Math.min(rows.length - 1, overlap.lastIdx + haloSentenceCount)
  const slice = rows.slice(haloStart, haloEnd + 1)

  return {
    haloSentences: slice.map((s) => s.text),
    markedStart: overlap.firstIdx - haloStart + 1,
    markedEnd: overlap.lastIdx - haloStart + 1,
    fileCharStart: rows[overlap.firstIdx].start,
    fileCharEnd: rows[overlap.lastIdx].end,
    haloCharStart: rows[haloStart].start,
    haloCharEnd: rows[haloEnd].end,
  }
}

export const buildHalo = (
  rawFile: string,
  charStart: number,
  charEnd: number,
  haloSentenceCount: number
): HaloResult | null => {
  const rows = indexFileSentences(rawFile)
  return buildHaloForRows(rows, charStart, charEnd, haloSentenceCount)
}
