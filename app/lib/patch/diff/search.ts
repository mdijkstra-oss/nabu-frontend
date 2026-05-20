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

const MIN_CONTIGUOUS_RUN = 2
const CONTIGUOUS_RUN_RATIO = 0.5

const toLines = (text: string): string[] => {
  const lines = text.split("\n")
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  return lines
}

const toTokens = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? []

const longestContiguousRun = (contentTokens: string[], needleTokens: string[]): number => {
  let maxRun = 0
  for (let i = 0; i < contentTokens.length; i++) {
    for (let j = 0; j < needleTokens.length; j++) {
      let run = 0
      while (
        i + run < contentTokens.length &&
        j + run < needleTokens.length &&
        contentTokens[i + run] === needleTokens[j + run]
      ) {
        run++
      }
      if (run > maxRun) maxRun = run
    }
  }
  return maxRun
}

interface LineCandidate {
  index: number
  exact: boolean
}

const findLineCandidates = (needleLine: string, contentLines: string[]): LineCandidate[] => {
  const exactCandidates: LineCandidate[] = []

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i] === needleLine) {
      exactCandidates.push({ index: i, exact: true })
    }
  }

  if (exactCandidates.length > 0) return exactCandidates

  const candidates: LineCandidate[] = []
  const needleTokens = toTokens(needleLine)

  if (needleTokens.length === 0) return candidates

  for (let i = 0; i < contentLines.length; i++) {
    const contentTokens = toTokens(contentLines[i])
    const run = longestContiguousRun(contentTokens, needleTokens)
    const isFullTokenMatch =
      run === needleTokens.length && run / contentTokens.length >= CONTIGUOUS_RUN_RATIO
    const isPartialTokenMatch =
      run < needleTokens.length &&
      run >= MIN_CONTIGUOUS_RUN &&
      run / needleTokens.length >= CONTIGUOUS_RUN_RATIO

    if (isFullTokenMatch || isPartialTokenMatch) {
      candidates.push({ index: i, exact: false })
    }
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
