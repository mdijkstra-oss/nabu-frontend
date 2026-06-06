import type { Segment } from "./types"
import { splitBySentences } from "./split"
import { locateTextInSentences } from "./present"

export const normalizeMatchWhitespace = (match: string): string => match.replace(/\n\n+/g, " ")

interface Range {
  start: number
  end: number
}

const CONTEXT_BUDGET = 30
const MIN_STUB_WORDS = 8
export const SEPARATOR = "\n\n<!--SPLIT-->\n\n"
const WORD_RE = /\s+/
const LOCATE_THRESHOLD = 1

const wordCount = (text: string): number => text.split(WORD_RE).filter(Boolean).length

const taketail = (text: string, count: number): string => {
  const words = text.split(WORD_RE).filter(Boolean)
  if (words.length <= count) return text
  return words.slice(-count).join(" ")
}

const takeHead = (text: string, count: number): string => {
  const words = text.split(WORD_RE).filter(Boolean)
  if (words.length <= count) return text
  return words.slice(0, count).join(" ")
}

const mergeRanges = (ranges: Range[]): Range[] => {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Range[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]
    if (sorted[i].start <= prev.end + 1) {
      prev.end = Math.max(prev.end, sorted[i].end)
    } else {
      merged.push({ ...sorted[i] })
    }
  }
  return merged
}

const locateMatch = (sentenceTexts: string[], match: string): Range | null => {
  const result = locateTextInSentences(sentenceTexts, match, LOCATE_THRESHOLD)
  if (!result) return null
  return { start: result.start - 1, end: result.end - 1 }
}

const locateAll = (sentenceTexts: string[], matches: string[]): Range[] =>
  matches
    .map((m) => locateMatch(sentenceTexts, normalizeMatchWhitespace(m)))
    .filter((r): r is Range => r !== null)

const gapWordCount = (segments: Segment[], a: Range, b: Range): number => {
  let total = 0
  for (let i = a.end + 1; i < b.start; i++) total += wordCount(segments[i].text)
  return total
}

const mergeClose = (ranges: Range[], segments: Segment[], budget: number): Range[] => {
  if (ranges.length <= 1) return ranges
  const merged: Range[] = [{ ...ranges[0] }]
  for (let i = 1; i < ranges.length; i++) {
    const prev = merged[merged.length - 1]
    if (gapWordCount(segments, prev, ranges[i]) <= 2 * budget) {
      prev.end = ranges[i].end
    } else {
      merged.push({ ...ranges[i] })
    }
  }
  return merged
}

interface ExpandedEdge {
  boundary: number
  truncated: { index: number; words: number } | null
}

const expandBefore = (segments: Segment[], from: number, budget: number): ExpandedEdge => {
  let used = 0
  let boundary = from
  for (let i = from - 1; i >= 0; i--) {
    const w = wordCount(segments[i].text)
    if (used + w <= budget) {
      used += w
      boundary = i
    } else {
      const remaining = budget - used
      if (remaining >= MIN_STUB_WORDS)
        return { boundary, truncated: { index: i, words: remaining } }
      return { boundary, truncated: null }
    }
  }
  return { boundary, truncated: null }
}

const expandAfter = (segments: Segment[], from: number, budget: number): ExpandedEdge => {
  let used = 0
  let boundary = from
  for (let i = from + 1; i < segments.length; i++) {
    const w = wordCount(segments[i].text)
    if (used + w <= budget) {
      used += w
      boundary = i
    } else {
      const remaining = budget - used
      if (remaining >= MIN_STUB_WORDS)
        return { boundary, truncated: { index: i, words: remaining } }
      return { boundary, truncated: null }
    }
  }
  return { boundary, truncated: null }
}

const originalGap = (text: string, segments: Segment[], a: number, b: number): string =>
  text.slice(segments[a].end, segments[b].start)

const renderRegion = (
  text: string,
  segments: Segment[],
  range: Range,
  budget: number,
  isFirst: boolean,
  isLast: boolean
): string => {
  const before = expandBefore(segments, range.start, budget)
  const after = expandAfter(segments, range.end, budget)

  const parts: string[] = []

  const hasHiddenBefore = before.truncated === null && before.boundary > 0

  if (before.truncated) {
    parts.push("…" + taketail(segments[before.truncated.index].text, before.truncated.words))
    parts.push(originalGap(text, segments, before.truncated.index, before.boundary))
  } else if (isFirst && hasHiddenBefore) {
    parts.push("…" + originalGap(text, segments, before.boundary - 1, before.boundary))
  }

  parts.push(text.slice(segments[before.boundary].start, segments[after.boundary].end))

  const hasHiddenAfter = after.truncated === null && after.boundary < segments.length - 1

  if (after.truncated) {
    parts.push(originalGap(text, segments, after.boundary, after.truncated.index))
    parts.push(takeHead(segments[after.truncated.index].text, after.truncated.words) + "…")
  } else if (isLast && hasHiddenAfter) {
    parts.push(originalGap(text, segments, after.boundary, after.boundary + 1) + "…")
  }

  return parts.join("")
}

const splitSentenceSegments = splitBySentences()

export const trimAroundMatches = (text: string, matches: string[]): string => {
  if (matches.length === 0) return text

  const segments = splitSentenceSegments(text)
  if (segments.length === 0) return text

  const sentenceTexts = segments.map((s) => s.text)
  const matchRanges = locateAll(sentenceTexts, matches)
  if (matchRanges.length === 0) return ""

  const merged = mergeRanges(matchRanges)
  const regions = mergeClose(merged, segments, CONTEXT_BUDGET)

  return regions
    .map((r, i) =>
      renderRegion(text, segments, r, CONTEXT_BUDGET, i === 0, i === regions.length - 1)
    )
    .join(SEPARATOR)
}

export interface SentenceRange {
  start: number
  end: number
}

const clampRange = (range: SentenceRange, segmentCount: number): Range | null => {
  if (segmentCount === 0) return null
  const start = Math.max(0, Math.min(range.start, segmentCount - 1))
  const end = Math.max(start, Math.min(range.end, segmentCount - 1))
  return { start, end }
}

export const trimByRanges = (text: string, ranges: SentenceRange[]): string => {
  if (ranges.length === 0) return text

  const segments = splitSentenceSegments(text)
  if (segments.length === 0) return text

  const clamped = ranges
    .map((r) => clampRange(r, segments.length))
    .filter((r): r is Range => r !== null)
  if (clamped.length === 0) return ""

  const merged = mergeRanges(clamped)
  const regions = mergeClose(merged, segments, CONTEXT_BUDGET)

  return regions
    .map((r, i) =>
      renderRegion(text, segments, r, CONTEXT_BUDGET, i === 0, i === regions.length - 1)
    )
    .join(SEPARATOR)
}
