import { createCappedCache } from "~/lib/utils/cache"

export interface MatchOffset {
  start: number
  end: number
}

const TOKEN_OVERLAP_THRESHOLD = 0.8
const MIN_FUZZY_WORDS = 4
const MIN_UNIQUE_FUZZY_WORDS = 2

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

const tokenCache = createCappedCache<string, Token[]>(50)

const getDocTokens = (content: string): Token[] => {
  const cached = tokenCache.get(content)
  if (cached) return cached
  const tokens = tokenize(content)
  tokenCache.set(content, tokens)
  return tokens
}

const scoreTokenWindow = (needleWords: Set<string>, windowTokens: Token[]): number => {
  let hits = 0
  for (const token of windowTokens) {
    if (needleWords.has(token.word)) hits++
  }
  return hits / needleWords.size
}

const findUniqueTokenMatch = (
  docTokens: Token[],
  needleSet: Set<string>,
  windowSize: number
): MatchOffset | null => {
  let found: MatchOffset | null = null
  for (let i = 0; i <= docTokens.length - windowSize; i++) {
    const window = docTokens.slice(i, i + windowSize)
    if (scoreTokenWindow(needleSet, window) >= TOKEN_OVERLAP_THRESHOLD) {
      if (found) return null
      found = { start: window[0].start, end: window[window.length - 1].end }
    }
  }
  return found
}

const findTokenMatchOffset = (docTokens: Token[], needleWords: string[]): MatchOffset | null => {
  if (needleWords.length < MIN_UNIQUE_FUZZY_WORDS) return null

  const needleSet = new Set(needleWords)
  const windowSize = needleWords.length
  const requireUnique = needleWords.length < MIN_FUZZY_WORDS

  if (docTokens.length < windowSize) return null

  if (requireUnique) return findUniqueTokenMatch(docTokens, needleSet, windowSize)

  for (let i = 0; i <= docTokens.length - windowSize; i++) {
    const window = docTokens.slice(i, i + windowSize)
    if (scoreTokenWindow(needleSet, window) >= TOKEN_OVERLAP_THRESHOLD) {
      return { start: window[0].start, end: window[window.length - 1].end }
    }
  }

  return null
}

const flattenNewlines = (text: string): string => text.replace(/[\r\n]/g, " ")

const findExactOffset = (content: string, needle: string): MatchOffset | null => {
  const idx = flattenNewlines(content).toLowerCase().indexOf(flattenNewlines(needle).toLowerCase())
  if (idx < 0) return null
  return { start: idx, end: idx + needle.length }
}

const findBestOffset = (content: string, needle: string): MatchOffset | null => {
  const exact = findExactOffset(content, needle)
  if (exact) return exact

  const docTokens = getDocTokens(content)
  const needleWords = tokenizeWords(needle)
  return findTokenMatchOffset(docTokens, needleWords)
}

export const findMatchOffset = (content: string, needle: string): MatchOffset | null =>
  findBestOffset(content, needle)
