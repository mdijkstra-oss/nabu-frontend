export const isBlankLine = (s: string): boolean => /^[ \t]*$/.test(s)

export const normalizeLine = (line: string): string =>
  normalizeListMarkers(spacesToTabs(trimTrailing(line)))

export const normalizeContent = (text: string): string =>
  trimTrailingBlanks(
    collapseBlankLines(ensureHeadingSpacing(text.split("\n").map(normalizeLine)))
  ).join("\n")

const isHeading = (s: string): boolean => /^#{1,6} /.test(s)

const isFenceLine = (s: string): boolean => /^```/.test(s)

const ensureHeadingSpacing = (lines: string[]): string[] => {
  const result: string[] = []
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (isFenceLine(line)) {
      inFence = !inFence
      result.push(line)
      continue
    }

    if (inFence || !isHeading(line)) {
      result.push(line)
      continue
    }

    const prev = result[result.length - 1]
    if (prev !== undefined && !isBlankLine(prev)) result.push("")
    result.push(line)
    const next = lines[i + 1]
    if (next !== undefined && !isBlankLine(next)) result.push("")
  }

  return result
}

export const normalizeListMarkers = (text: string): string =>
  text.replace(/^([ \t]*)[-+] /gm, "$1* ")

const trimTrailing = (s: string): string => s.replace(/[ \t]+$/, "")

const spacesToTabs = (s: string): string => {
  const match = s.match(/^([ \t]*)(.*)$/)
  if (!match) return s
  const [, indent, rest] = match
  const tabified = indent.replace(/ {2}/g, "\t").replace(/ /g, "")
  return tabified + rest
}

const collapseBlankLines = (lines: string[]): string[] =>
  lines.reduce<string[]>((acc, line) => {
    const prev = acc[acc.length - 1]
    if (isBlankLine(line) && prev !== undefined && isBlankLine(prev)) return acc
    acc.push(isBlankLine(line) ? "" : line)
    return acc
  }, [])

const trimTrailingBlanks = (lines: string[]): string[] => {
  const result = [...lines]
  while (result.length > 0 && isBlankLine(result[result.length - 1])) result.pop()
  return result
}
