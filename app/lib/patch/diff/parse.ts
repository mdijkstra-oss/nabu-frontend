import { findMatches, getMatchedText, type Match } from "./search"
import { expandMatch, countLines } from "./context"
import { normalizeContent, normalizeLine, isBlankLine } from "./normalize"

export type HunkPart =
  | { type: "context"; content: string }
  | { type: "remove"; content: string }
  | { type: "add"; content: string }

export interface Hunk {
  parts: HunkPart[]
}

type DiffResult = { ok: true; content: string } | { ok: false; error: string }

const isHunkStart = (line: string): boolean =>
  line === "@@" || line.startsWith("@@ ") || line === "+@@" || line.startsWith("+@@ ")

const isFileHeader = (line: string): boolean => line.startsWith("*** ")

const isAddLine = (line: string): boolean => line.startsWith("+")

const stripAddPrefix = (line: string): string =>
  line.startsWith("++") ? line.slice(2) : line.slice(1)

const isRemoveLine = (line: string): boolean => line.startsWith("-")

const stripTrailingSplitArtifact = (lines: string[]): string[] =>
  lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines

export const parseV4ADiff = (patch: string): Hunk[] => {
  const lines = stripTrailingSplitArtifact(patch.split("\n"))
  const hunks: Hunk[] = []
  let currentParts: HunkPart[] = []
  let inHunk = false
  let isAddFile = false

  const flushHunk = () => {
    if (inHunk && currentParts.length > 0) {
      hunks.push({ parts: currentParts })
    }
    currentParts = []
  }

  for (const line of lines) {
    if (line.startsWith("*** Add File:")) {
      flushHunk()
      isAddFile = true
      inHunk = true
      continue
    }

    if (line.startsWith("*** Update File:") || line.startsWith("*** Delete File:")) {
      flushHunk()
      isAddFile = false
      inHunk = false
      continue
    }

    if (isHunkStart(line)) {
      flushHunk()
      inHunk = true
      isAddFile = false
      continue
    }

    if (isFileHeader(line)) {
      continue
    }

    if (!inHunk && (isAddLine(line) || isRemoveLine(line))) {
      inHunk = true
    }

    if (!inHunk) {
      continue
    }

    if (isRemoveLine(line)) {
      currentParts.push({ type: "remove", content: line.slice(1) + "\n" })
    } else if (isAddLine(line)) {
      currentParts.push({ type: "add", content: stripAddPrefix(line) + "\n" })
    } else if (!isAddFile) {
      // Context line - no prefix in v4a format, use verbatim
      currentParts.push({ type: "context", content: line + "\n" })
    } else {
      currentParts.push({ type: "add", content: line + "\n" })
    }
  }

  flushHunk()
  return hunks
}

export const buildMatchText = (parts: HunkPart[]): string =>
  parts
    .filter((p) => p.type === "context" || p.type === "remove")
    .map((p) => p.content)
    .join("")
    .replace(/\n$/, "")

const buildAddText = (parts: HunkPart[]): string =>
  parts
    .filter((p) => p.type === "add")
    .map((p) => p.content)
    .join("")
    .replace(/\n$/, "")

const buildAllText = (parts: HunkPart[]): string =>
  parts
    .map((p) => p.content)
    .join("")
    .replace(/\n$/, "")

const buildReplacement = (parts: HunkPart[], matchedText: string): string => {
  const matchedLines = matchedText.split("\n")
  let lineIdx = 0
  const result: string[] = []

  for (const part of parts) {
    if (part.type === "context" || part.type === "remove") {
      if (part.type === "context") {
        result.push(matchedLines[lineIdx] + "\n")
      }
      lineIdx++
    } else if (part.type === "add") {
      result.push(part.content)
    }
  }

  return result.join("").replace(/\n$/, "")
}

const DEFAULT_MIN_CONTEXT_LINES = 3

const countNonBlankLines = (text: string): number =>
  text.split("\n").filter((line) => !isBlankLine(line)).length

const formatNotFoundError = (matchText: string, content: string): string => {
  const lineCount = content.split("\n").length
  return [
    `patch context not found in file (${lineCount} lines):`,
    "───",
    matchText,
    "───",
    `Include at least ${DEFAULT_MIN_CONTEXT_LINES} non-blank context lines. Verify the text exists verbatim in the file.`,
  ].join("\n")
}

const SKIP_CONTENT = "...\n"

const isSkipMarker = (part: HunkPart): boolean =>
  (part.type === "context" || part.type === "remove") && part.content === SKIP_CONTENT

type ExpandResult = { ok: true; parts: HunkPart[] } | { ok: false; error: string }

const expandSkipMarker = (parts: HunkPart[], content: string): ExpandResult => {
  const skipIdx = parts.findIndex(isSkipMarker)
  if (skipIdx === -1) return { ok: true, parts }

  const skipType = parts[skipIdx].type as "context" | "remove"

  const before = parts.slice(0, skipIdx)
  const after = parts.slice(skipIdx + 1)

  const startAnchor = buildMatchText(before)
  const endAnchor = buildMatchText(after)
  if (startAnchor === "") return { ok: false, error: "... requires preceding context lines" }
  if (endAnchor === "") return { ok: false, error: "... requires following context lines" }

  const startMatches = findMatches(content, startAnchor)
  if (startMatches.length === 0) return { ok: false, error: "... start anchor not found" }
  if (startMatches.length > 1) return { ok: false, error: "... start anchor ambiguous" }

  const contentLines = content.split("\n")
  const searchFrom = startMatches[0].end + 1
  const suffix = contentLines.slice(searchFrom).join("\n")
  const endMatches = findMatches(suffix, endAnchor)
  if (endMatches.length === 0) return { ok: false, error: "... end anchor not found" }
  if (endMatches.length > 1) return { ok: false, error: "... end anchor ambiguous" }

  const gapLines = contentLines.slice(searchFrom, searchFrom + endMatches[0].start)
  if (gapLines.length === 0)
    return { ok: false, error: "... anchors are adjacent, nothing to skip" }

  const gapParts: HunkPart[] = gapLines.map((line) => ({ type: skipType, content: line + "\n" }))
  return { ok: true, parts: [...before, ...gapParts, ...after] }
}

const applyHunk = (content: string, hunk: Hunk, minContextLines: number): DiffResult => {
  const expanded = expandSkipMarker(hunk.parts, content)
  if (!expanded.ok) return expanded
  const { parts } = expanded

  const matchText = buildMatchText(parts)

  const isEmptyFile = content === ""

  if (matchText === "" || isEmptyFile) {
    const allText = isEmptyFile ? buildAllText(parts) : buildAddText(parts)
    const needsSeparator = content.length > 0 && !content.endsWith("\n")
    return { ok: true, content: content + (needsSeparator ? "\n" : "") + allText }
  }

  const matches = findMatches(content, matchText)

  if (matches.length === 0) {
    const nonBlank = countNonBlankLines(matchText)
    if (nonBlank < minContextLines) {
      return {
        ok: false,
        error: `patch context too short: ${nonBlank} non-blank line(s). Include at least ${minContextLines} non-blank context/remove lines for reliable matching.`,
      }
    }
    return { ok: false, error: formatNotFoundError(matchText, content) }
  }

  if (matches.length > 1) {
    return { ok: false, error: formatAmbiguousError(content, matches) }
  }

  const matchedText = getMatchedText(content, matches[0])
  const newText = buildReplacement(parts, matchedText)
  return { ok: true, content: content.replace(matchedText, newText) }
}

export const applyHunks = (
  content: string,
  hunks: Hunk[],
  minContextLines: number = DEFAULT_MIN_CONTEXT_LINES
): DiffResult => {
  let result = content
  for (const hunk of hunks) {
    const applied = applyHunk(result, hunk, minContextLines)
    if (!applied.ok) return applied
    result = applied.content
  }
  return { ok: true, content: result }
}

export const applyDiff = (content: string, patch: string): DiffResult =>
  applyHunks(normalizeContent(content), parseV4ADiff(patch).map(normalizeHunk))

const normalizePartContent = (content: string): string =>
  normalizeLine(content.replace(/\n$/, "")) + "\n"

export const normalizeHunk = (hunk: Hunk): Hunk => ({
  parts: collapseBlankParts(
    hunk.parts.map((p) => ({ ...p, content: normalizePartContent(p.content) }))
  ),
})

const collapseBlankParts = (parts: HunkPart[]): HunkPart[] =>
  parts.reduce<HunkPart[]>((acc, part) => {
    const prev = acc[acc.length - 1]
    if (part.content === "\n" && prev?.content === "\n" && prev.type === part.type) return acc
    return [...acc, part]
  }, [])

const CONTEXT_LINES = 3

const formatAmbiguousError = (content: string, matches: Match[]): string => {
  const total = countLines(content)
  const expanded = matches.map((m, i) => {
    const exp = expandMatch(m, CONTEXT_LINES, total)
    const text = getMatchedText(content, exp)
    return `Match ${i + 1}:\n───\n${text}\n───`
  })

  return [
    `patch ambiguous: ${matches.length} matches found`,
    "",
    ...expanded,
    "",
    "Include more surrounding lines to disambiguate. If none look right, verify you're targeting the correct location.",
  ].join("\n")
}
