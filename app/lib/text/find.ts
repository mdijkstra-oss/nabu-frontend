import { createCappedCache } from "~/lib/utils/cache"

export interface MatchOffset {
  start: number
  end: number
}

const PRECISION_THRESHOLDS = [1, 0.95, 0.9]
const MIN_FUZZY_TOKENS = 5

interface Token {
  word: string
  start: number
  end: number
}

const WORD_PATTERN = /\S+/g

const normalizeWord = (raw: string): string =>
  raw.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = []
  let match: RegExpExecArray | null
  WORD_PATTERN.lastIndex = 0
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    const word = normalizeWord(match[0])
    if (word) tokens.push({ word, start: match.index, end: match.index + match[0].length })
  }
  return tokens
}

export const tokenizeWords = (text: string): string[] => {
  const words: string[] = []
  let match: RegExpExecArray | null
  WORD_PATTERN.lastIndex = 0
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    const word = normalizeWord(match[0])
    if (word) words.push(word)
  }
  return words
}

const tokenCache = createCappedCache<string, Token[]>(500)

const getDocTokens = (content: string): Token[] => {
  const cached = tokenCache.get(content)
  if (cached) return cached
  const tokens = tokenize(content)
  tokenCache.set(content, tokens)
  return tokens
}

const scoreOrderedSubsequence = (needleWords: string[], windowTokens: Token[]): number => {
  let matched = 0
  let windowIdx = 0
  for (const word of needleWords) {
    while (windowIdx < windowTokens.length) {
      if (windowTokens[windowIdx].word === word) {
        matched++
        windowIdx++
        break
      }
      windowIdx++
    }
  }
  return matched / needleWords.length
}

const findFirstTokenMatch = (
  docTokens: Token[],
  needleWords: string[],
  windowSize: number,
  threshold: number
): MatchOffset | null => {
  for (let i = 0; i <= docTokens.length - windowSize; i++) {
    const window = docTokens.slice(i, i + windowSize)
    if (scoreOrderedSubsequence(needleWords, window) >= threshold) {
      return { start: window[0].start, end: window[window.length - 1].end }
    }
  }
  return null
}

const selectThresholds = (tokenCount: number): number[] =>
  tokenCount < MIN_FUZZY_TOKENS ? [1] : PRECISION_THRESHOLDS

const findOrderedMatch = (docTokens: Token[], needleWords: string[]): MatchOffset | null => {
  const len = needleWords.length
  for (let i = 0; i <= docTokens.length - len; i++) {
    let match = true
    for (let j = 0; j < len; j++) {
      if (docTokens[i + j].word !== needleWords[j]) {
        match = false
        break
      }
    }
    if (match) return { start: docTokens[i].start, end: docTokens[i + len - 1].end }
  }
  return null
}

export const findMatchOffset = (
  content: string,
  needle: string,
  strict?: boolean
): MatchOffset | null => {
  const needleWords = tokenizeWords(needle)
  if (needleWords.length === 0) return null

  const docTokens = getDocTokens(content)
  if (docTokens.length < needleWords.length) return null

  const ordered = findOrderedMatch(docTokens, needleWords)
  if (ordered) return ordered
  if (strict) return null

  const thresholds = selectThresholds(needleWords.length)
  for (const threshold of thresholds) {
    const match = findFirstTokenMatch(docTokens, needleWords, needleWords.length, threshold)
    if (match) return match
  }
  return null
}
