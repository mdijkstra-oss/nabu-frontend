import type { Segment } from "./types"
import { splitBySentences } from "./split"

interface Range {
  start: number
  end: number
}

const CONTEXT_BUDGET = 30
const MIN_STUB_WORDS = 8
const WORD_RE = /\s+/

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

interface ExpandedEdge {
  boundary: number
  truncated: { index: number; words: number } | null
  used: number
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
        return { boundary, truncated: { index: i, words: remaining }, used }
      return { boundary, truncated: null, used }
    }
  }
  return { boundary, truncated: null, used }
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
        return { boundary, truncated: { index: i, words: remaining }, used }
      return { boundary, truncated: null, used }
    }
  }
  return { boundary, truncated: null, used }
}

const originalGap = (text: string, segments: Segment[], a: number, b: number): string =>
  text.slice(segments[a].end, segments[b].start)

const splitSentenceSegments = splitBySentences()

export interface TrimmedRegion {
  text: string
  sourceStart: number
  sourceEnd: number
}

interface PadResult {
  text: string
  bytesUsed: number
}

const padBefore = (leading: string, budget: number): PadResult | null => {
  if (leading.length === 0 || budget < MIN_STUB_WORDS) return null
  const segments = splitSentenceSegments(leading)
  if (segments.length === 0) return null
  const edge = expandBefore(segments, segments.length, budget)
  if (edge.boundary >= segments.length) return null

  const parts: string[] = []
  if (edge.truncated) {
    parts.push("…" + taketail(segments[edge.truncated.index].text, edge.truncated.words))
    parts.push(originalGap(leading, segments, edge.truncated.index, edge.boundary))
  } else if (edge.boundary > 0) {
    parts.push("…" + originalGap(leading, segments, edge.boundary - 1, edge.boundary))
  }
  parts.push(leading.slice(segments[edge.boundary].start))

  return { text: parts.join(""), bytesUsed: leading.length - segments[edge.boundary].start }
}

const padAfter = (trailing: string, budget: number): PadResult | null => {
  if (trailing.length === 0 || budget < MIN_STUB_WORDS) return null
  const segments = splitSentenceSegments(trailing)
  if (segments.length === 0) return null
  const edge = expandAfter(segments, -1, budget)
  if (edge.boundary < 0) return null

  const parts: string[] = []
  parts.push(trailing.slice(0, segments[edge.boundary].end))
  if (edge.truncated) {
    parts.push(originalGap(trailing, segments, edge.boundary, edge.truncated.index))
    parts.push(takeHead(segments[edge.truncated.index].text, edge.truncated.words) + "…")
  } else if (edge.boundary < segments.length - 1) {
    parts.push(originalGap(trailing, segments, edge.boundary, edge.boundary + 1) + "…")
  }

  return { text: parts.join(""), bytesUsed: segments[edge.boundary].end }
}

interface DecorationOpts {
  leading?: string
  trailing?: string
}

interface Decoration {
  text: string
  bytesShift: number
}

const renderBeforeDecoration = (
  text: string,
  segments: Segment[],
  before: ExpandedEdge,
  isFirst: boolean,
  leading: string | undefined,
  budget: number
): Decoration => {
  if (before.truncated) {
    const stub = "…" + taketail(segments[before.truncated.index].text, before.truncated.words)
    const gap = originalGap(text, segments, before.truncated.index, before.boundary)
    return { text: stub + gap, bytesShift: 0 }
  }
  if (isFirst && before.boundary === 0 && leading) {
    const pad = padBefore(leading, budget - before.used)
    if (pad) return { text: pad.text, bytesShift: pad.bytesUsed }
  }
  if (isFirst && before.boundary > 0) {
    return {
      text: "…" + originalGap(text, segments, before.boundary - 1, before.boundary),
      bytesShift: 0,
    }
  }
  return { text: "", bytesShift: 0 }
}

const renderAfterDecoration = (
  text: string,
  segments: Segment[],
  after: ExpandedEdge,
  isLast: boolean,
  trailing: string | undefined,
  budget: number
): Decoration => {
  if (after.truncated) {
    const gap = originalGap(text, segments, after.boundary, after.truncated.index)
    const stub = takeHead(segments[after.truncated.index].text, after.truncated.words) + "…"
    return { text: gap + stub, bytesShift: 0 }
  }
  if (isLast && after.boundary === segments.length - 1 && trailing) {
    const pad = padAfter(trailing, budget - after.used)
    if (pad) return { text: pad.text, bytesShift: pad.bytesUsed }
  }
  if (isLast && after.boundary < segments.length - 1) {
    return {
      text: originalGap(text, segments, after.boundary, after.boundary + 1) + "…",
      bytesShift: 0,
    }
  }
  return { text: "", bytesShift: 0 }
}

const renderRegion = (
  text: string,
  segments: Segment[],
  range: Range,
  budget: number,
  isFirst: boolean,
  isLast: boolean,
  opts: DecorationOpts
): TrimmedRegion => {
  const before = expandBefore(segments, range.start, budget)
  const after = expandAfter(segments, range.end, budget)

  const beforeDeco = renderBeforeDecoration(text, segments, before, isFirst, opts.leading, budget)
  const afterDeco = renderAfterDecoration(text, segments, after, isLast, opts.trailing, budget)

  const core = text.slice(segments[before.boundary].start, segments[after.boundary].end)

  return {
    text: beforeDeco.text + core + afterDeco.text,
    sourceStart: segments[before.boundary].start - beforeDeco.bytesShift,
    sourceEnd: segments[after.boundary].end + afterDeco.bytesShift,
  }
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

export interface TrimOptions {
  leading?: string
  trailing?: string
}

export const trimByRanges = (
  text: string,
  ranges: SentenceRange[],
  opts: TrimOptions = {}
): TrimmedRegion[] => {
  if (ranges.length === 0) return [{ text, sourceStart: 0, sourceEnd: text.length }]

  const segments = splitSentenceSegments(text)
  if (segments.length === 0) return [{ text, sourceStart: 0, sourceEnd: text.length }]

  const clamped = ranges
    .map((r) => clampRange(r, segments.length))
    .filter((r): r is Range => r !== null)
  if (clamped.length === 0) return []

  const regions = mergeRanges(clamped)

  return regions.map((r, i) =>
    renderRegion(text, segments, r, CONTEXT_BUDGET, i === 0, i === regions.length - 1, opts)
  )
}
