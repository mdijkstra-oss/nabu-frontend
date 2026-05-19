import { findMatchOffset, tokenizeWords } from "~/lib/text/find"
import { charOffsetToLine } from "~/lib/text/lines"

export interface Match {
  start: number
  end: number
  fuzzy: boolean
}

export const findMatches = (content: string, needle: string): Match[] => {
  const contentLines = toLines(content)
  const needleLines = toLines(needle)

  if (needleLines.length === 0) return []
  if (needleLines.length > contentLines.length) return []

  const candidates = needleLines.map((line) => findLineCandidates(line, contentLines))
  const blocks = findConsecutiveBlocks(candidates)

  if (blocks.length > 0) return toMatches(blocks)

  if (needleLines.length === 1) return findSubstringMatches(content, needle)

  return []
}

export const getMatchedText = (content: string, match: Match): string => {
  const lines = toLines(content)
  return lines.slice(match.start, match.end + 1).join("\n")
}

const SIMILARITY_THRESHOLD = 0.9
const TOKEN_THRESHOLD = 0.8
const MIN_TOKEN_WORDS = 4
const MIN_PREFIX_LENGTH = 80
const PREFIX_OVERLAP_THRESHOLD = 0.8

const toLines = (text: string): string[] => {
  const lines = text.split("\n")
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  return lines
}

const toBigrams = (s: string): Map<string, number> => {
  const grams = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const pair = s.slice(i, i + 2)
    grams.set(pair, (grams.get(pair) ?? 0) + 1)
  }
  return grams
}

const bigramSimilarity = (a: string, b: string): number => {
  if (a === b) return 1
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la === lb) return 1
  if (la.length < 2 || lb.length < 2) return 0
  const gramsA = toBigrams(la)
  const gramsB = toBigrams(lb)
  let intersection = 0
  for (const [pair, countB] of gramsB) {
    const countA = gramsA.get(pair) ?? 0
    intersection += Math.min(countA, countB)
  }
  return (2 * intersection) / (la.length - 1 + lb.length - 1)
}

const tokenSimilarity = (a: string, b: string): number => {
  const wordsA = tokenizeWords(a)
  const wordsB = tokenizeWords(b)
  if (wordsA.length < MIN_TOKEN_WORDS || wordsB.length < MIN_TOKEN_WORDS) return 0
  const setA = new Set(wordsA)
  let hits = 0
  for (const w of wordsB) {
    if (setA.has(w)) hits++
  }
  return hits / wordsB.length
}

interface LineCandidate {
  index: number
  exact: boolean
}

const findLineCandidates = (needleLine: string, contentLines: string[]): LineCandidate[] => {
  const candidates: LineCandidate[] = []
  const matchedIndices = new Set<number>()

  for (let i = 0; i < contentLines.length; i++) {
    const contentLine = contentLines[i]

    if (contentLine === needleLine) {
      candidates.push({ index: i, exact: true })
      matchedIndices.add(i)
      continue
    }

    if (bigramSimilarity(contentLine, needleLine) >= SIMILARITY_THRESHOLD) {
      candidates.push({ index: i, exact: false })
      matchedIndices.add(i)
      continue
    }

    if (tokenSimilarity(contentLine, needleLine) >= TOKEN_THRESHOLD) {
      candidates.push({ index: i, exact: false })
      matchedIndices.add(i)
      continue
    }
  }

  for (const idx of findTokenPrefixCandidates(needleLine, contentLines, matchedIndices)) {
    candidates.push({ index: idx, exact: false })
  }

  return candidates
}

const prefixOverlap = (
  needleWords: string[],
  contentWords: string[],
  windowSize: number
): number => {
  const contentSet = new Set(contentWords.slice(0, windowSize))
  const needleWindow = needleWords.slice(0, windowSize)
  let hits = 0
  for (const word of needleWindow) {
    if (contentSet.has(word)) hits++
  }
  return hits / needleWindow.length
}

const findTokenPrefixCandidates = (
  needleLine: string,
  contentLines: string[],
  excludeIndices: Set<number>
): number[] => {
  const stripped = needleLine.endsWith("...") ? needleLine.slice(0, -3) : needleLine
  const needleWords = tokenizeWords(stripped)

  if (needleWords.length === 0 || stripped.length < MIN_PREFIX_LENGTH) return []

  const eligibleMap = new Map<number, string[]>()
  for (let i = 0; i < contentLines.length; i++) {
    if (excludeIndices.has(i)) continue
    const contentWords = tokenizeWords(contentLines[i])
    if (contentWords.length <= needleWords.length) continue
    eligibleMap.set(i, contentWords)
  }

  if (eligibleMap.size === 0) return []

  let candidates = [...eligibleMap.keys()]

  for (let w = 1; w <= needleWords.length; w++) {
    const narrowed = candidates.filter((idx) => {
      const contentWords = eligibleMap.get(idx)
      return (
        contentWords !== undefined &&
        prefixOverlap(needleWords, contentWords, w) >= PREFIX_OVERLAP_THRESHOLD
      )
    })

    if (narrowed.length === 0) break
    candidates = narrowed
    if (candidates.length <= 1) break
  }

  return candidates
}

interface ConsecutiveBlock {
  start: number
  end: number
  allExact: boolean
}

const findConsecutiveBlocks = (candidates: LineCandidate[][]): ConsecutiveBlock[] => {
  if (candidates.length === 0) return []

  const lookups = candidates.map((cs) => {
    const map = new Map<number, LineCandidate>()
    for (const c of cs) map.set(c.index, c)
    return map
  })

  const blocks: ConsecutiveBlock[] = []

  for (const seed of candidates[0]) {
    let allExact = seed.exact
    let valid = true

    for (let offset = 1; offset < candidates.length; offset++) {
      const expected = seed.index + offset
      const found = lookups[offset].get(expected)
      if (!found) {
        valid = false
        break
      }
      if (!found.exact) allExact = false
    }

    if (valid) {
      blocks.push({
        start: seed.index,
        end: seed.index + candidates.length - 1,
        allExact,
      })
    }
  }

  return blocks
}

const toMatches = (blocks: ConsecutiveBlock[]): Match[] => {
  const sorted = [...blocks].sort((a, b) => {
    if (a.allExact !== b.allExact) return a.allExact ? -1 : 1
    return a.start - b.start
  })
  return sorted.map((b) => ({ start: b.start, end: b.end, fuzzy: !b.allExact }))
}

const findSubstringMatches = (content: string, needle: string): Match[] => {
  const offset = findMatchOffset(content, needle)
  if (!offset) return []
  const startLine = charOffsetToLine(content, offset.start)
  const endLine = charOffsetToLine(content, offset.end)
  return [{ start: startLine, end: endLine, fuzzy: true }]
}
