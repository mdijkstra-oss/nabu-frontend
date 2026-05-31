import { getEditorSelection } from "~/lib/editor/selection-store"
import type { EditorSelection } from "~/lib/editor/selection-store"
import { findMatchOffset, findWithPartialEdges } from "~/lib/text/find"
import { charOffsetToLine, lineToCharOffset, getLineContent } from "~/lib/text/lines"
import { countLines } from "~/lib/text/stats"
import { stripCodeBlockLines } from "~/lib/data-blocks/strip-lines"
import { getFileRaw } from "~/lib/files/store"
import { extractEditorSelections } from "~/lib/editor/selection-dom"
import type { MatchOffset } from "~/lib/text/find"

export interface TextSpan {
  text: string
  startOffset: number
  endOffset: number
}

export interface FileSelectionRange {
  filePath: string
  startLine: number
  endLine: number
  exact: TextSpan
  fullWords: TextSpan
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

const isNonWhitespace = (ch: string): boolean => !/\s/.test(ch)

const expandToWordBoundaries = (content: string, start: number, end: number): TextSpan => {
  let s = start
  let e = end
  while (s > 0 && isNonWhitespace(content[s - 1])) s--
  while (e < content.length && isNonWhitespace(content[e])) e++
  return { text: content.slice(s, e), startOffset: s, endOffset: e }
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
  const exact: TextSpan = {
    text: fileContent.slice(startOffset, endOffset),
    startOffset,
    endOffset,
  }
  const fullWords = expandToWordBoundaries(fileContent, startOffset, endOffset)
  return { filePath, startLine, endLine, exact, fullWords }
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

export const resolveEditorSelection = (): FileSelectionRange | null => {
  const selection = getEditorSelection()
  if (!selection?.filePath) return null
  const fileContent = getFileRaw(selection.filePath)
  if (!fileContent) return null
  return locateSelectionInFile(
    selection.text,
    selection.filePath,
    fileContent,
    selection.context ?? undefined
  )
}

export const resolveSearchSelections = (): FileSelectionRange[] => {
  const slices = extractEditorSelections()
  const ranges: FileSelectionRange[] = []
  for (const { filePath, selectedText, context } of slices) {
    const fileContent = getFileRaw(filePath)
    if (!fileContent) continue
    const range = locateSelectionInFile(selectedText, filePath, fileContent, context)
    if (range) ranges.push(range)
  }
  return ranges
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
