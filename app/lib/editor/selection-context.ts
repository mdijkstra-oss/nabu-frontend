import type { EditorSelection } from "~/lib/editor/selection-store"
import { findMatchOffset } from "~/lib/text/find"
import { charOffsetToLine, getLineContent } from "~/lib/text/lines"
import { countLines } from "~/lib/text/stats"

const ENTIRE_DOCUMENT_THRESHOLD = 0.9
const TRUNCATION_BOUNDARY = 20
const TRUNCATION_EDGE = 3

const formatLineNumber = (line: number, width: number): string =>
  String(line + 1).padStart(width, " ")

const addLineNumbers = (content: string, startLine: number): string => {
  const lines = content.split("\n")
  const lastLine = startLine + lines.length - 1
  const width = String(lastLine + 1).length
  return lines.map((l, i) => `${formatLineNumber(startLine + i, width)} | ${l}`).join("\n")
}

const isEntireDocument = (totalLines: number, selectionLines: number): boolean =>
  selectionLines / totalLines >= ENTIRE_DOCUMENT_THRESHOLD

const formatTruncated = (rawMarkdown: string, startLine: number, endLine: number): string => {
  const head = getLineContent(rawMarkdown, startLine, startLine + TRUNCATION_EDGE - 1)
  const tail = getLineContent(rawMarkdown, endLine - TRUNCATION_EDGE + 1, endLine)
  const omitted = endLine - startLine + 1 - 2 * TRUNCATION_EDGE
  return [
    addLineNumbers(head, startLine),
    `... (${omitted} lines omitted) ...`,
    addLineNumbers(tail, endLine - TRUNCATION_EDGE + 1),
  ].join("\n")
}

export const formatSelectionContext = (
  selection: EditorSelection,
  rawMarkdown: string
): string | null => {
  const offset = findMatchOffset(rawMarkdown, selection.text)
  if (!offset) return null

  const startLine = charOffsetToLine(rawMarkdown, offset.start)
  const endLine = charOffsetToLine(rawMarkdown, offset.end)
  const totalLines = countLines(rawMarkdown)
  const selectionLines = endLine - startLine + 1

  if (isEntireDocument(totalLines, selectionLines)) return "User selected the entire document"

  const rawLines = getLineContent(rawMarkdown, startLine, endLine)
  const needsTruncation = selectionLines > TRUNCATION_BOUNDARY

  const formatted = needsTruncation
    ? formatTruncated(rawMarkdown, startLine, endLine)
    : addLineNumbers(rawLines, startLine)

  return `User selected lines ${startLine + 1}-${endLine + 1}:\n${formatted}`
}
