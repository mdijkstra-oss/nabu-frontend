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

const isWordChar = (ch: string): boolean => /[a-zA-Z0-9]/.test(ch)

const isWhitespace = (ch: string): boolean => /\s/.test(ch)

const wordCharsOf = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, "")

const consumeBackward = (content: string, fromPos: number, partialRaw: string): number | null => {
  const chars = wordCharsOf(partialRaw)
  if (chars.length === 0) return fromPos
  let ci = fromPos - 1
  let pi = chars.length - 1
  while (ci >= 0 && isWhitespace(content[ci])) ci--
  while (ci >= 0 && pi >= 0) {
    if (isWordChar(content[ci])) {
      if (content[ci] !== chars[pi]) return null
      pi--
    }
    ci--
  }
  if (pi >= 0) return null
  return ci + 1
}

const consumeForward = (content: string, fromPos: number, partialRaw: string): number | null => {
  const chars = wordCharsOf(partialRaw)
  if (chars.length === 0) return fromPos
  let ci = fromPos
  let pi = 0
  while (ci < content.length && isWhitespace(content[ci])) ci++
  while (ci < content.length && pi < chars.length) {
    if (isWordChar(content[ci])) {
      if (content[ci] !== chars[pi]) return null
      pi++
    }
    ci++
  }
  if (pi < chars.length) return null
  return ci
}

const findTwoTokenMatch = (
  content: string,
  contentTokens: Token[],
  needleTokens: Token[],
  needle: string
): MatchOffset | null => {
  const [first, second] = needleTokens
  const firstRaw = needle.slice(first.start, first.end)
  const lastRaw = needle.slice(second.start, second.end)

  const secondMatch = findOrderedMatch(contentTokens, [second.word])
  if (secondMatch) {
    const start = consumeBackward(content, secondMatch.start, firstRaw)
    if (start !== null) return { start, end: secondMatch.end }
  }

  const firstMatch = findOrderedMatch(contentTokens, [first.word])
  if (firstMatch) {
    const end = consumeForward(content, firstMatch.end, lastRaw)
    if (end !== null) return { start: firstMatch.start, end }
  }

  return null
}

export const findWithPartialEdges = (content: string, needle: string): MatchOffset | null => {
  const needleTokens = tokenize(needle)
  if (needleTokens.length < 2) return null

  const contentTokens = getDocTokens(content)

  if (needleTokens.length === 2)
    return findTwoTokenMatch(content, contentTokens, needleTokens, needle)

  const innerTokens = needleTokens.slice(1, -1)
  const innerWords = innerTokens.map((t) => t.word)
  const innerMatch = findOrderedMatch(contentTokens, innerWords)
  if (!innerMatch) return null

  const firstRaw = needle.slice(needleTokens[0].start, needleTokens[0].end)
  const lastToken = needleTokens[needleTokens.length - 1]
  const lastRaw = needle.slice(lastToken.start, lastToken.end)

  const start = consumeBackward(content, innerMatch.start, firstRaw)
  if (start === null) return null

  const end = consumeForward(content, innerMatch.end, lastRaw)
  if (end === null) return null

  return { start, end }
}

export const expandWithContext = (
  text: string,
  start: number,
  end: number,
  padWords: number
): string => {
  const tokens = tokenize(text)
  if (tokens.length === 0) return text.slice(start, end)

  let selStartIdx = tokens.findIndex((t) => t.start >= start)
  if (selStartIdx === -1) selStartIdx = tokens.length

  let selEndIdx = selStartIdx
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].end <= end) {
      selEndIdx = i
      break
    }
  }

  const contextStartIdx = Math.max(0, selStartIdx - padWords)
  const contextEndIdx = Math.min(tokens.length - 1, selEndIdx + padWords)

  return text.slice(tokens[contextStartIdx].start, tokens[contextEndIdx].end)
}
