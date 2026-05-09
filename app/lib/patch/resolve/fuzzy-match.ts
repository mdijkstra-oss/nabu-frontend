import { findMatchOffset } from "~/lib/text/find"

const FUZZY_PATTERN = /FUZZY\[\[([\s\S]+?)\]\]/g

interface FuzzyMatch {
  placeholder: string
  needle: string
  replacement: string | null
}

const findBestMatch = (content: string, needle: string): string | null => {
  const offset = findMatchOffset(content, needle)
  return offset ? content.slice(offset.start, offset.end) : null
}

const collectFuzzyPatterns = (patch: string): FuzzyMatch[] => {
  const matches: FuzzyMatch[] = []
  let match: RegExpExecArray | null

  FUZZY_PATTERN.lastIndex = 0
  while ((match = FUZZY_PATTERN.exec(patch)) !== null) {
    matches.push({
      placeholder: match[0],
      needle: match[1],
      replacement: null,
    })
  }

  return matches
}

interface FuzzyResult {
  patch: string
  resolved: number
  unresolved: string[]
}

export const resolveFuzzyPatterns = (patch: string, targetContent: string): FuzzyResult => {
  const patterns = collectFuzzyPatterns(patch)
  if (patterns.length === 0) {
    return { patch, resolved: 0, unresolved: [] }
  }

  let result = patch
  let resolved = 0
  const unresolved: string[] = []

  for (const pattern of patterns) {
    const match = findBestMatch(targetContent, pattern.needle)
    if (match) {
      result = result.replace(pattern.placeholder, match)
      resolved++
    } else {
      unresolved.push(pattern.needle)
    }
  }

  return { patch: result, resolved, unresolved }
}

const FUZZY_PREFIX = "FUZZY[["

export const hasFuzzyPatterns = (content: string): boolean => content.includes(FUZZY_PREFIX)
