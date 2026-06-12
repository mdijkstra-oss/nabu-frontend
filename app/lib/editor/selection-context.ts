import { getEditorSelection } from "~/lib/editor/selection-store"
import type { EditorSelection } from "~/lib/editor/selection-store"
import { findMatchOffset, findWithPartialEdges } from "~/lib/text/find"
import { charOffsetToLine, lineToCharOffset } from "~/lib/text/lines"
import { stripCodeBlockLines } from "~/lib/data-blocks/strip-lines"
import { neutralizeMarkdown } from "~/lib/text/split"
import { getFileRaw } from "~/lib/files/store"
import { extractEditorSelections } from "~/lib/editor/selection-dom"
import type { MatchOffset } from "~/lib/text/find"
import { proseOf, indexFileSentences, buildHaloForRows } from "~/lib/text/halo"

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

// Context is selection text + padding words from the editor view.
// It disambiguates when the selection text appears more than once in the file
// (e.g. selecting a short common phrase). Context is best-effort, not required:
//
// - Search-result slices stitch non-contiguous regions with "\n\n…\n\n" trim
//   markers. Padding around a selection near such a marker pulls the marker
//   into context, and the marker has no counterpart in the source file.
// - Real prose can also contain "…" ("because I… wanted to say"), so we can't
//   safely strip it from context without risking false collisions.
// - The context build can also produce text that doesn't survive markdown
//   neutralization (callout headers, hidden blocks) and won't match strict.
//
// When the context-narrowed lookup fails for any reason, fall through to a
// global search of the stripped file. Selections wide enough to fail context
// matching are also wide enough that ambiguous global matches are rare.
const matchInStripped = (
  stripped: string,
  selectionText: string,
  context: string | undefined
): MatchOffset | null => {
  if (context) {
    const contextOffset = findMatchOffset(stripped, context, true)
    if (contextOffset) {
      const region = stripped.slice(contextOffset.start, contextOffset.end)
      const selInRegion = findInRegion(region, selectionText)
      if (selInRegion) {
        return {
          start: contextOffset.start + selInRegion.start,
          end: contextOffset.start + selInRegion.end,
        }
      }
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
  neutralized: string,
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
  const expanded = expandToWordBoundaries(neutralized, offset.start, offset.end)
  const fullStart = strippedOffsetToOriginal(stripped, fileContent, lineMap, expanded.startOffset)
  const fullEnd = strippedOffsetToOriginal(stripped, fileContent, lineMap, expanded.endOffset)
  const fullWords: TextSpan = {
    text: fileContent.slice(fullStart, fullEnd),
    startOffset: fullStart,
    endOffset: fullEnd,
  }
  return { filePath, startLine, endLine, exact, fullWords }
}

export const locateSelectionInFile = (
  selectionText: string,
  filePath: string,
  fileContent: string,
  context?: string
): FileSelectionRange | null => {
  const { content: stripped, lineMap } = stripCodeBlockLines(fileContent)
  const neutralized = neutralizeMarkdown(stripped)
  const offset = matchInStripped(neutralized, selectionText, context)
  if (!offset) return null
  return remapToOriginal(filePath, fileContent, stripped, neutralized, lineMap, offset)
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

const HALO_SENTENCE_COUNT = 3

const findInProse = (prose: string, text: string): MatchOffset | null =>
  findMatchOffset(prose, text, true) ?? findWithPartialEdges(prose, text)

export const formatSelectionContext = (
  selection: EditorSelection,
  rawMarkdown: string
): string | null => {
  const prose = proseOf(rawMarkdown)
  const offset = findInProse(prose, selection.text)
  if (!offset) return null

  const rows = indexFileSentences(rawMarkdown)
  const halo = buildHaloForRows(rows, offset.start, offset.end, HALO_SENTENCE_COUNT)
  if (!halo) return null

  const coversWholeDoc =
    halo.haloSentences.length === rows.length &&
    halo.markedStart === 1 &&
    halo.markedEnd === rows.length
  if (coversWholeDoc) return null

  const before = prose.slice(halo.haloCharStart, offset.start).trim()
  const marked = prose.slice(offset.start, offset.end).trim()
  const after = prose.slice(offset.end, halo.haloCharEnd).trim()

  const parts: string[] = []
  if (before) parts.push(before)
  parts.push(`<selected>${marked}</selected>`)
  if (after) parts.push(after)

  return `<context>${parts.join(" ")}</context>`
}
