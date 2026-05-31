import type { EditorSelection } from "~/lib/editor/selection-store"
import { findMatchOffset, findWithPartialEdges } from "~/lib/text/find"
import { charOffsetToLine, lineToCharOffset, getLineContent } from "~/lib/text/lines"
import { countLines } from "~/lib/text/stats"
import { stripCodeBlockLines } from "~/lib/data-blocks/strip-lines"
import type { MatchOffset } from "~/lib/text/find"

export interface FileSelectionRange {
  filePath: string
  startLine: number
  endLine: number
  startOffset: number
  endOffset: number
  text: string
}

const strippedOffsetToOriginal = (
  stripped: string,
  fileContent: string,
  lineMap: number[],
  strippedOffset: number
): number => {
  const strippedLine = charOffsetToLine(stripped, strippedOffset)
  const inLineOffset = strippedOffset - lineToCharOffset(stripped, strippedLine)
  const originalLine = lineMap[strippedLine] - 1
  return lineToCharOffset(fileContent, originalLine) + inLineOffset
}

const findInRegion = (region: string, selectionText: string): MatchOffset | null =>
  findMatchOffset(region, selectionText, true) ?? findWithPartialEdges(region, selectionText)

const matchInStripped = (
  stripped: string,
  selectionText: string,
  context: string | undefined
): MatchOffset | null => {
  if (context) {
    const contextOffset = findMatchOffset(stripped, context, true)
    if (!contextOffset) return null
    const region = stripped.slice(contextOffset.start, contextOffset.end)
    const selInRegion = findInRegion(region, selectionText)
    if (!selInRegion) return null
    return {
      start: contextOffset.start + selInRegion.start,
      end: contextOffset.start + selInRegion.end,
    }
  }
  return findInRegion(stripped, selectionText)
}

const remapToOriginal = (
  filePath: string,
  fileContent: string,
  stripped: string,
  lineMap: number[],
  offset: MatchOffset
): FileSelectionRange => {
  const startOffset = strippedOffsetToOriginal(stripped, fileContent, lineMap, offset.start)
  const endOffset = strippedOffsetToOriginal(stripped, fileContent, lineMap, offset.end)
  const startLine = charOffsetToLine(fileContent, startOffset)
  const endLine = charOffsetToLine(fileContent, endOffset)
  const text = fileContent.slice(startOffset, endOffset)
  return { filePath, startLine, endLine, startOffset, endOffset, text }
}

export const locateSelectionInFile = (
  selectionText: string,
  filePath: string,
  fileContent: string,
  context?: string
): FileSelectionRange | null => {
  const { content: stripped, lineMap } = stripCodeBlockLines(fileContent)
  const offset = matchInStripped(stripped, selectionText, context)
  if (!offset) return null
  return remapToOriginal(filePath, fileContent, stripped, lineMap, offset)
}

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
  const range = locateSelectionInFile(selection.text, "", rawMarkdown)
  if (!range) return null

  const totalLines = countLines(rawMarkdown)
  const selectionLines = range.endLine - range.startLine + 1

  if (isEntireDocument(totalLines, selectionLines)) return "User selected the entire document"

  const needsTruncation = selectionLines > TRUNCATION_BOUNDARY

  const formatted = needsTruncation
    ? formatTruncated(rawMarkdown, range.startLine, range.endLine)
    : addLineNumbers(getLineContent(rawMarkdown, range.startLine, range.endLine), range.startLine)

  return `User selected lines ${range.startLine + 1}-${range.endLine + 1}:\n${formatted}`
}
