import { findAllStrictMatchOffsets } from "./find"

export interface Span {
  start: number
  end: number
}

export type AnchorResolution = Span | { error: string }

const ELLIPSIS = "..."
const CONTEXT_LINES = 2

export const isAnchorError = (r: AnchorResolution): r is { error: string } => "error" in r

const findAllExactMatches = (content: string, needle: string): Span[] => {
  const matches: Span[] = []
  let from = 0
  while (true) {
    const idx = content.indexOf(needle, from)
    if (idx === -1) return matches
    matches.push({ start: idx, end: idx + needle.length })
    from = idx + needle.length
  }
}

const charToLine = (content: string, offset: number): number => {
  let line = 0
  const limit = Math.min(offset, content.length)
  for (let i = 0; i < limit; i++) if (content[i] === "\n") line++
  return line
}

const formatMatchContext = (content: string, span: Span): string => {
  const lines = content.split("\n")
  const startLine = charToLine(content, span.start)
  const endLine = charToLine(content, span.end)
  const from = Math.max(0, startLine - CONTEXT_LINES)
  const to = Math.min(lines.length - 1, endLine + CONTEXT_LINES)
  return lines
    .slice(from, to + 1)
    .map((l, i) => `  ${from + i + 1}: ${l}`)
    .join("\n")
}

const formatAmbiguous = (content: string, matches: Span[], label: string): string => {
  const sections = matches.map((m, i) => {
    const line = charToLine(content, m.start) + 1
    return `Match ${i + 1} (line ${line}):\n${formatMatchContext(content, m)}`
  })
  return `${label} matches ${matches.length} locations — add more context to disambiguate:\n\n${sections.join("\n\n")}`
}

interface MatchSet {
  matches: Span[]
}

const findAnchorMatches = (content: string, needle: string): MatchSet => {
  const exact = findAllExactMatches(content, needle)
  if (exact.length > 0) return { matches: exact }
  return { matches: findAllStrictMatchOffsets(content, needle) }
}

const resolveSingleAnchor = (content: string, needle: string, label: string): AnchorResolution => {
  const { matches } = findAnchorMatches(content, needle)
  if (matches.length === 0) return { error: `${label} not found` }
  if (matches.length > 1) return { error: formatAmbiguous(content, matches, label) }
  return matches[0]
}

const offsetSpan = (span: Span, offset: number): Span => ({
  start: span.start + offset,
  end: span.end + offset,
})

const resolveRange = (content: string, before: string, after: string): AnchorResolution => {
  if (!before.trim() || !after.trim())
    return { error: "`...` requires non-empty anchor text on both sides" }

  const beforeResult = resolveSingleAnchor(content, before, "anchor before `...`")
  if (isAnchorError(beforeResult)) return beforeResult

  const tail = content.slice(beforeResult.end)
  const afterRaw = findAnchorMatches(tail, after)
  if (afterRaw.matches.length === 0)
    return { error: "anchor after `...` not found following the first anchor" }
  if (afterRaw.matches.length > 1) {
    const translated = afterRaw.matches.map((m) => offsetSpan(m, beforeResult.end))
    return { error: formatAmbiguous(content, translated, "anchor after `...`") }
  }

  return { start: beforeResult.start, end: beforeResult.end + afterRaw.matches[0].end }
}

export const resolveAnchor = (content: string, needle: string): AnchorResolution => {
  if (needle.includes(ELLIPSIS)) {
    const idx = needle.indexOf(ELLIPSIS)
    if (idx !== needle.lastIndexOf(ELLIPSIS))
      return { error: "only one `...` per anchor is supported" }
    return resolveRange(content, needle.slice(0, idx), needle.slice(idx + ELLIPSIS.length))
  }

  return resolveSingleAnchor(content, needle, "anchor")
}
