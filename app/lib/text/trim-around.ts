interface Range {
  start: number
  end: number
}

const SEPARATOR = "\n\n…\n\n"
const PARAGRAPH_SPLIT = /\n\n+/
const WORD_SPLIT = /\s+/
const SHORT_PARAGRAPH_WORDS = 20
const MAX_PARAGRAPH_WORDS = 120

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim()

const splitParagraphs = (text: string): string[] =>
  text.split(PARAGRAPH_SPLIT).filter((p) => p.trim().length > 0)

const wordCount = (text: string): number => text.split(WORD_SPLIT).filter(Boolean).length

const isShortParagraph = (text: string): boolean => wordCount(text) < SHORT_PARAGRAPH_WORDS

const paragraphContainsMatch = (paragraph: string, match: string): boolean => {
  if (paragraph.includes(match) || match.includes(paragraph)) return true
  const normalizedParagraph = collapseWhitespace(paragraph)
  const normalizedMatch = collapseWhitespace(match)
  return (
    normalizedParagraph.includes(normalizedMatch) || normalizedMatch.includes(normalizedParagraph)
  )
}

const findMatchingParagraphs = (paragraphs: string[], match: string): number[] => {
  const indices: number[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphContainsMatch(paragraphs[i], match)) indices.push(i)
  }
  return indices
}

const expandShortParagraph = (index: number, total: number): Range => {
  const start = Math.max(0, index - 1)
  const end = Math.min(total - 1, index + 1)
  return { start, end }
}

const mergeRanges = (ranges: Range[]): Range[] => {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Range[] = [sorted[0]]
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

const collectSelectedRanges = (paragraphs: string[], matches: string[]): Range[] =>
  matches.flatMap((match) => {
    const indices = findMatchingParagraphs(paragraphs, match)
    return indices.map((i) =>
      isShortParagraph(paragraphs[i])
        ? expandShortParagraph(i, paragraphs.length)
        : { start: i, end: i }
    )
  })

const findMatchWordIndex = (words: string[], match: string): number => {
  const joined = words.join(" ")
  const charIdx = joined.indexOf(collapseWhitespace(match))
  if (charIdx === -1) return -1
  const prefix = joined.slice(0, charIdx)
  return prefix.split(WORD_SPLIT).filter(Boolean).length
}

const findEarliestMatchWord = (words: string[], matches: string[]): number => {
  let earliest = -1
  for (const match of matches) {
    const idx = findMatchWordIndex(words, match)
    if (idx !== -1 && (earliest === -1 || idx < earliest)) earliest = idx
  }
  return earliest
}

const capParagraph = (text: string, matches: string[]): string => {
  const words = text.split(WORD_SPLIT).filter(Boolean)
  if (words.length <= MAX_PARAGRAPH_WORDS) return text

  const matchWordIdx = findEarliestMatchWord(words, matches)

  if (matchWordIdx === -1) {
    return words.slice(0, MAX_PARAGRAPH_WORDS).join(" ") + " …"
  }

  const half = Math.floor(MAX_PARAGRAPH_WORDS / 2)
  let start = Math.max(0, matchWordIdx - half)
  let end = start + MAX_PARAGRAPH_WORDS
  if (end > words.length) {
    end = words.length
    start = Math.max(0, end - MAX_PARAGRAPH_WORDS)
  }

  const slice = words.slice(start, end).join(" ")
  const prefix = start > 0 ? "… " : ""
  const suffix = end < words.length ? " …" : ""
  return prefix + slice + suffix
}

const extractRegion = (paragraphs: string[], range: Range, matches: string[]): string =>
  paragraphs
    .slice(range.start, range.end + 1)
    .map((p) => capParagraph(p, matches))
    .join("\n\n")

const coversAll = (ranges: Range[], total: number): boolean =>
  ranges.length === 1 && ranges[0].start === 0 && ranges[0].end === total - 1

export const normalizeMatchWhitespace = (match: string): string => match.replace(/\n\n+/g, " ")

export const trimAroundMatches = (text: string, matches: string[]): string => {
  if (matches.length === 0) return text
  const normalized = matches.map(normalizeMatchWhitespace)
  const paragraphs = splitParagraphs(text)
  if (paragraphs.length === 0) return text

  const raw = collectSelectedRanges(paragraphs, normalized)
  if (raw.length === 0) return text

  const merged = mergeRanges(raw)
  const regions = merged.map((r) => extractRegion(paragraphs, r, normalized))

  if (coversAll(merged, paragraphs.length)) return regions.join("\n\n")

  return regions.join(SEPARATOR)
}
