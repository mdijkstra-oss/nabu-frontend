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

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" })

const normalizeWord = (raw: string): string =>
  raw
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")

const isAbsorbable = (ch: string): boolean => !/[\p{L}\p{N}\s]/u.test(ch)

const expandTokenSpan = (
  text: string,
  start: number,
  end: number
): { start: number; end: number } => {
  let s = start
  while (s > 0 && isAbsorbable(text[s - 1])) s--
  let e = end
  while (e < text.length && isAbsorbable(text[e])) e++
  return { start: s, end: e }
}

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = []
  for (const seg of wordSegmenter.segment(text)) {
    if (!seg.isWordLike) continue
    const word = normalizeWord(seg.segment)
    if (!word) continue
    const span = expandTokenSpan(text, seg.index, seg.index + seg.segment.length)
    tokens.push({ word, start: span.start, end: span.end })
  }
  return tokens
}

export const tokenizeWords = (text: string): string[] => tokenize(text).map((t) => t.word)

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

const findAllOrderedMatches = (docTokens: Token[], needleWords: string[]): MatchOffset[] => {
  const matches: MatchOffset[] = []
  const len = needleWords.length
  for (let i = 0; i <= docTokens.length - len; i++) {
    let match = true
    for (let j = 0; j < len; j++) {
      if (docTokens[i + j].word !== needleWords[j]) {
        match = false
        break
      }
    }
    if (match) matches.push({ start: docTokens[i].start, end: docTokens[i + len - 1].end })
  }
  return matches
}

export const findAllStrictMatchOffsets = (content: string, needle: string): MatchOffset[] => {
  const needleWords = tokenizeWords(needle)
  if (needleWords.length === 0) return []
  const docTokens = getDocTokens(content)
  if (docTokens.length < needleWords.length) return []
  return findAllOrderedMatches(docTokens, needleWords)
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

interface TokenRun {
  length: number
  startInA: number
  startInB: number
}

const longestTokenRun = (a: string[], b: string[]): TokenRun => {
  if (a.length === 0 || b.length === 0) return { length: 0, startInA: 0, startInB: 0 }
  let maxLen = 0
  let maxStartA = 0
  let maxStartB = 0
  let prev = new Array(b.length + 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    const curr = new Array(b.length + 1).fill(0)
    for (let j = 0; j < b.length; j++) {
      if (a[i] === b[j]) {
        curr[j + 1] = prev[j] + 1
        if (curr[j + 1] > maxLen) {
          maxLen = curr[j + 1]
          maxStartA = i - curr[j + 1] + 1
          maxStartB = j - curr[j + 1] + 1
        }
      }
    }
    prev = curr
  }
  return { length: maxLen, startInA: maxStartA, startInB: maxStartB }
}

const countShared = (chunkTokens: string[], needleTokens: string[]): number => {
  const set = new Set(chunkTokens)
  let count = 0
  for (const t of needleTokens) if (set.has(t)) count++
  return count
}

export interface OwningChunkOptions {
  minWords: number
}

export const findOwningChunk = <T extends { text: string }>(
  chunks: T[],
  needle: string,
  opts: OwningChunkOptions
): T | null => {
  const needleTokens = tokenizeWords(needle)
  if (needleTokens.length < opts.minWords) return null

  let best: { run: number; start: number; idx: number; chunk: T } | null = null
  for (let i = 0; i < chunks.length; i++) {
    const chunkTokens = tokenizeWords(chunks[i].text)
    if (countShared(chunkTokens, needleTokens) < opts.minWords) continue
    const { length, startInA } = longestTokenRun(chunkTokens, needleTokens)
    if (length < opts.minWords) continue
    if (
      !best ||
      length > best.run ||
      (length === best.run && startInA < best.start) ||
      (length === best.run && startInA === best.start && i < best.idx)
    ) {
      best = { run: length, start: startInA, idx: i, chunk: chunks[i] }
    }
  }
  return best ? best.chunk : null
}

export const growToInclude = (text: string, needle: string): string => {
  const chunkTokensFull = tokenize(text)
  const needleTokensFull = tokenize(needle)
  if (chunkTokensFull.length === 0 || needleTokensFull.length === 0) return text

  const chunkWords = chunkTokensFull.map((t) => t.word)
  const needleWords = needleTokensFull.map((t) => t.word)
  const { length, startInA, startInB } = longestTokenRun(chunkWords, needleWords)
  if (length === 0) return text

  const matchTouchesChunkStart = startInA === 0
  const matchTouchesChunkEnd = startInA + length === chunkWords.length
  const annotationHeadMissing = startInB > 0
  const annotationTailMissing = startInB + length < needleWords.length

  let result = text
  if (matchTouchesChunkEnd && annotationTailMissing) {
    const tailStart = needleTokensFull[startInB + length - 1].end
    result = result + needle.slice(tailStart)
  }
  if (matchTouchesChunkStart && annotationHeadMissing) {
    const headEnd = needleTokensFull[startInB].start
    result = needle.slice(0, headEnd) + result
  }
  return result
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
