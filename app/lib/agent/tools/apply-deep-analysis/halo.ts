import { splitBySentences } from "~/lib/text/split"
import { extractProse } from "~/lib/data-blocks/parse"
import { stripMarkdown } from "~/lib/text/strip"

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
}

const splitSentencesWithOffsets = splitBySentences()

export const proseOf = (rawFile: string): string =>
  stripMarkdown(extractProse(rawFile), { keepHeadings: true })

export const indexFileSentences = (rawFile: string): SentenceRow[] => {
  const prose = proseOf(rawFile)
  return splitSentencesWithOffsets(prose)
    .map((s) => ({ text: s.text, start: s.start, end: s.end }))
    .filter((s) => s.text.trim().length > 0)
}

const findOverlappingRange = (
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
