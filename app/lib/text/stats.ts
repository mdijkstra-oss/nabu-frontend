import { CHARS_PER_TOKEN } from "./constants"

interface TextStats {
  chars: number
  words: number
  readingTimeMinutes: number
  estimatedTokens: number
}

const WORDS_PER_MINUTE = 238

export const countLines = (text: string): number => text.split("\n").length

export const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length

export const computeTextStats = (text: string): TextStats => {
  const chars = text.length
  const words = countWords(text)
  const readingTimeMinutes = words / WORDS_PER_MINUTE
  const estimatedTokens = Math.ceil(chars / CHARS_PER_TOKEN)
  return { chars, words, readingTimeMinutes, estimatedTokens }
}

const formatNumber = (n: number): string => n.toLocaleString()

export const formatReadingTime = (minutes: number): string => {
  if (minutes < 1) return "< 1 min read"
  const rounded = Math.round(minutes)
  return `${rounded} min read`
}

export const formatStatsLabel = (stats: TextStats): string =>
  `${formatNumber(stats.words)} words · ${formatReadingTime(stats.readingTimeMinutes)}`

export const formatStatsDetail = (stats: TextStats): string =>
  `${formatNumber(stats.chars)} characters · ~${formatNumber(stats.estimatedTokens)} tokens`

export const formatSelectionSuffix = (selectionText: string | undefined): string => {
  if (!selectionText) return ""
  const n = countWords(selectionText)
  return n > 0 ? ` (${n} words selected)` : ""
}
