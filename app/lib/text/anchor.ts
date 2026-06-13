import { findAllStrictMatchOffsets } from "./find"

export interface Span {
  start: number
  end: number
}

export type AnchorResolution = Span | { error: string }

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

const findAnchorMatches = (content: string, needle: string): Span[] => {
  const exact = findAllExactMatches(content, needle)
  if (exact.length > 0) return exact
  return findAllStrictMatchOffsets(content, needle)
}

const resolveOne = (content: string, needle: string, label: string): AnchorResolution => {
  const matches = findAnchorMatches(content, needle)
  if (matches.length === 0) return { error: `${label} not found` }
  if (matches.length > 1) return { error: formatAmbiguous(content, matches, label) }
  return matches[0]
}

const offsetSpan = (span: Span, offset: number): Span => ({
  start: span.start + offset,
  end: span.end + offset,
})

export const resolveAnchor = (content: string, needle: string): AnchorResolution =>
  resolveOne(content, needle, "anchor")

export const resolveAnchorRange = (
  content: string,
  anchorStart: string,
  anchorEnd: string
): AnchorResolution => {
  if (!anchorStart.trim() || !anchorEnd.trim())
    return { error: "anchor_start and anchor_end must each be non-empty" }

  const startResult = resolveOne(content, anchorStart, "anchor_start")
  if (isAnchorError(startResult)) return startResult

  const startLine = charToLine(content, startResult.start) + 1
  const startPrefix = `anchor_start matched uniquely at line ${startLine}. `

  const tail = content.slice(startResult.end)
  const endMatches = findAnchorMatches(tail, anchorEnd)
  if (endMatches.length === 0)
    return { error: `${startPrefix}anchor_end not found after that line.` }
  if (endMatches.length > 1) {
    const translated = endMatches.map((m) => offsetSpan(m, startResult.end))
    return { error: startPrefix + formatAmbiguous(content, translated, "anchor_end") }
  }

  return { start: startResult.start, end: startResult.end + endMatches[0].end }
}
