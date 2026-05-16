import type { Segment, Splitter } from "./types"

const isNonEmpty = (s: Segment): boolean => s.text.trim().length > 0

const buildSegmenter = (lang: string): Intl.Segmenter =>
  new Intl.Segmenter(lang, { granularity: "sentence" })

const toSpaces = (s: string): string => " ".repeat(s.length)

const neutralizeLink = (_: string, text: string, url: string): string =>
  " " + text + "  " + toSpaces(url) + " "

const neutralizeImageLink = (_: string, alt: string, url: string): string =>
  "  " + alt + "  " + toSpaces(url) + " "

const neutralizeWrapped =
  (marker: string) =>
  (_: string, content: string): string =>
    toSpaces(marker) + content + toSpaces(marker)

export const neutralizeMarkdown = (text: string): string =>
  text
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, neutralizeImageLink)
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, neutralizeLink)
    .replace(/\*\*(.+?)\*\*/g, neutralizeWrapped("**"))
    .replace(/~~(.+?)~~/g, neutralizeWrapped("~~"))
    .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, neutralizeWrapped("*"))
    .replace(/_([^_]+?)_/g, neutralizeWrapped("_"))
    .replace(/^#{1,6} /gm, toSpaces)

const collectSegments = (
  segmenter: Intl.Segmenter,
  processed: string,
  original: string
): Segment[] => {
  const segments: Segment[] = []
  for (const { segment, index } of segmenter.segment(processed)) {
    const trimmed = segment.trim()
    if (trimmed.length === 0) continue
    const start = index + segment.indexOf(trimmed)
    const end = start + trimmed.length
    segments.push({ text: original.slice(start, end), start, end })
  }
  return segments
}

export const splitBySentences = (lang = "en"): Splitter => {
  const segmenter = buildSegmenter(lang)
  return (text) => collectSegments(segmenter, text, text)
}

export const splitMarkdownBySentences = (lang = "en"): Splitter => {
  const segmenter = buildSegmenter(lang)
  return (text) => collectSegments(segmenter, neutralizeMarkdown(text), text)
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
