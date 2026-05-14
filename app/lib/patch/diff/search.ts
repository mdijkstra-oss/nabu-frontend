import { findMatchOffset } from "~/lib/text/find"
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

  const exactMatches = findExactMatches(contentLines, needleLines)
  if (exactMatches.length > 0) return exactMatches

  const fuzzyMatches = findFuzzyMatches(contentLines, needleLines)
  if (fuzzyMatches.length > 0) return fuzzyMatches

  if (needleLines.length === 1) return findSubstringMatches(content, needle)

  return []
}

export const getMatchedText = (content: string, match: Match): string => {
  const lines = toLines(content)
  return lines.slice(match.start, match.end + 1).join("\n")
}

const SIMILARITY_THRESHOLD = 0.9

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

const findExactMatches = (contentLines: string[], needleLines: string[]): Match[] => {
  const matches: Match[] = []
  const needleText = needleLines.join("\n")

  for (let i = 0; i <= contentLines.length - needleLines.length; i++) {
    const slice = contentLines.slice(i, i + needleLines.length)
    if (slice.join("\n") === needleText) {
      matches.push({ start: i, end: i + needleLines.length - 1, fuzzy: false })
    }
  }

  return matches
}

const blockSimilarity = (
  contentLines: string[],
  needleLines: string[],
  startIndex: number
): number => {
  let totalScore = 0

  for (let i = 0; i < needleLines.length; i++) {
    const score = bigramSimilarity(contentLines[startIndex + i], needleLines[i])
    if (score < SIMILARITY_THRESHOLD) return 0
    totalScore += score
  }

  return totalScore / needleLines.length
}

const findFuzzyMatches = (contentLines: string[], needleLines: string[]): Match[] => {
  const matches: { match: Match; score: number }[] = []

  for (let i = 0; i <= contentLines.length - needleLines.length; i++) {
    const score = blockSimilarity(contentLines, needleLines, i)
    if (score >= SIMILARITY_THRESHOLD) {
      matches.push({ match: { start: i, end: i + needleLines.length - 1, fuzzy: true }, score })
    }
  }

  return matches.sort((a, b) => b.score - a.score).map((m) => m.match)
}

const findSubstringMatches = (content: string, needle: string): Match[] => {
  const offset = findMatchOffset(content, needle)
  if (!offset) return []
  const startLine = charOffsetToLine(content, offset.start)
  const endLine = charOffsetToLine(content, offset.end)
  return [{ start: startLine, end: endLine, fuzzy: true }]
}
