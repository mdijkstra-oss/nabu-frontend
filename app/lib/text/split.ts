import { neutralizeForSplitting } from "./mark"
import type { Segment, Splitter } from "./types"

const isNonEmpty = (s: Segment): boolean => s.text.trim().length > 0

const buildSegmenter = (lang: string): Intl.Segmenter =>
  new Intl.Segmenter(lang, { granularity: "sentence" })

const leadingWhitespace = (s: string): number => s.length - s.trimStart().length

// A plain splitter has nothing marked, and an empty array answers no to every offset.
const NO_MARKUP: boolean[] = []

interface TrimmedSegment {
  segmentEnd: number
  start: number
  end: number
}

const trimmedSegments = (segmenter: Intl.Segmenter, processed: string): TrimmedSegment[] => {
  const trimmed: TrimmedSegment[] = []
  for (const { segment, index } of segmenter.segment(processed)) {
    const text = segment.trim()
    if (text.length === 0) continue
    const start = index + leadingWhitespace(segment)
    trimmed.push({ segmentEnd: index + segment.length, start, end: start + text.length })
  }
  return trimmed
}

// The segmenter trims whitespace off a segment's edges, and blanked markup reads as
// whitespace, so a link or a bold phrase comes back cut in half unless the row takes its
// syntax back. Opening markup is claimed first, across every row, because the segmenter
// hands a sentence's leading whitespace to the segment before it — so a row that reached
// forward first would take the next row's opening bracket and never give it up.
const expandOverMarkup = (recoverable: boolean[], segments: TrimmedSegment[]): void => {
  const isMarkup = (offset: number): boolean => recoverable[offset] === true

  segments.forEach((segment, i) => {
    const floor = i === 0 ? 0 : segments[i - 1].end
    while (segment.start > floor && isMarkup(segment.start - 1)) segment.start--
  })

  segments.forEach((segment, i) => {
    const ceiling = Math.min(segment.segmentEnd, segments[i + 1]?.start ?? segment.segmentEnd)
    while (segment.end < ceiling && isMarkup(segment.end)) segment.end++
  })
}

const collectSegments = (
  segmenter: Intl.Segmenter,
  processed: string,
  original: string,
  recoverable: boolean[]
): Segment[] => {
  const segments = trimmedSegments(segmenter, processed)
  expandOverMarkup(recoverable, segments)
  return segments.map(({ start, end }) => ({ text: original.slice(start, end), start, end }))
}

export const splitBySentences = (lang = "en"): Splitter => {
  const segmenter = buildSegmenter(lang)
  return (text) => collectSegments(segmenter, text, text, NO_MARKUP)
}

const defaultSentenceSplitter = splitBySentences()

export const splitSentences = (text: string): string[] =>
  defaultSentenceSplitter(text).map((s) => s.text)

export const splitMarkdownBySentences = (lang = "en"): Splitter => {
  const segmenter = buildSegmenter(lang)
  return (text) => {
    const neutralized = neutralizeForSplitting(text)
    return collectSegments(segmenter, neutralized.text, text, neutralized.recoverable)
  }
}

const splitOn = (text: string, separator: string | RegExp): Segment[] => {
  const parts = text.split(separator)
  const segments: Segment[] = []
  let offset = 0

  for (const part of parts) {
    const start = text.indexOf(part, offset)
    const end = start + part.length
    segments.push({ text: part, start, end })
    offset = end
  }

  return segments
}

export const splitByLines: Splitter = (text) => splitOn(text, "\n")

export const splitByParagraphs: Splitter = (text) => splitOn(text, /\n\n+/).filter(isNonEmpty)
