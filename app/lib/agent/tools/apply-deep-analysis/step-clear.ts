import { findMatchOffset } from "~/lib/text/find"

export interface AnnotationRef {
  id?: string
  code?: string
  text: string
  locked?: boolean
}

export interface RemoveAnnotationOp {
  op: "remove_annotation"
  match: { id: string }
}

export interface ClearStepResult {
  ops: RemoveAnnotationOp[]
}

const EXPAND_LINES = 4

const formatCodes = (codes: ReadonlySet<string>): string => [...codes].join(", ")

const hasMatchingCode = (
  a: AnnotationRef,
  codes: ReadonlySet<string>
): a is AnnotationRef & { id: string; code: string } => !!a.id && !!a.code && codes.has(a.code)

const isNonBlank = (line: string): boolean => line.trim().length > 0

const expandSectionRange = (
  lines: readonly string[],
  startIdx: number,
  endIdx: number,
  expandBy: number
): { expandedStart: number; expandedEnd: number } => {
  let expandedStart = startIdx
  let found = 0
  for (let i = startIdx - 1; i >= 0; i--) {
    expandedStart = i
    if (isNonBlank(lines[i])) found++
    if (found >= expandBy) break
  }

  let expandedEnd = endIdx
  found = 0
  for (let i = endIdx; i < lines.length; i++) {
    expandedEnd = i + 1
    if (isNonBlank(lines[i])) found++
    if (found >= expandBy) break
  }

  return { expandedStart, expandedEnd }
}

const buildExpandedContext = (
  content: string,
  startLine: number,
  endLine: number,
  expandBy: number
): { blob: string; sectionCharStart: number; sectionCharEnd: number } => {
  const lines = content.split("\n")
  const startIdx = startLine - 1
  const endIdx = endLine

  const { expandedStart, expandedEnd } = expandSectionRange(lines, startIdx, endIdx, expandBy)

  const prePadding = lines.slice(expandedStart, startIdx)
  const sectionLines = lines.slice(startIdx, endIdx)

  const prePaddingText = prePadding.join("\n")
  const sectionText = sectionLines.join("\n")
  const blob = lines.slice(expandedStart, expandedEnd).join("\n")

  const sectionCharStart = prePadding.length > 0 ? prePaddingText.length + 1 : 0
  const sectionCharEnd = sectionCharStart + sectionText.length

  return { blob, sectionCharStart, sectionCharEnd }
}

const doesOverlapSection = (
  matchStart: number,
  matchEnd: number,
  sectionCharStart: number,
  sectionCharEnd: number
): boolean => matchStart < sectionCharEnd && matchEnd > sectionCharStart

const isTextOverlappingSection = (
  blob: string,
  text: string,
  sectionCharStart: number,
  sectionCharEnd: number
): boolean => {
  const match = findMatchOffset(blob, text)
  if (!match) return false
  return doesOverlapSection(match.start, match.end, sectionCharStart, sectionCharEnd)
}

export const buildRemovalOps = (
  annotations: readonly AnnotationRef[],
  content: string,
  codes: ReadonlySet<string>,
  startLine: number,
  endLine: number
): RemoveAnnotationOp[] => {
  const { blob, sectionCharStart, sectionCharEnd } = buildExpandedContext(
    content,
    startLine,
    endLine,
    EXPAND_LINES
  )
  return annotations
    .filter((a) => !a.locked)
    .filter((a) => hasMatchingCode(a, codes))
    .filter((a) => isTextOverlappingSection(blob, a.text, sectionCharStart, sectionCharEnd))
    .map((a) => ({ op: "remove_annotation" as const, match: { id: a.id } }))
}

export const clearAnnotationsOnSection = (
  annotations: readonly AnnotationRef[],
  content: string,
  codes: ReadonlySet<string>,
  path: string,
  startLine: number,
  endLine: number
): ClearStepResult => {
  console.debug(
    `[deep-analysis-replace] clear: targeting ${path} [${startLine}-${endLine}], codes: [${formatCodes(codes)}]`
  )
  const ops = buildRemovalOps(annotations, content, codes, startLine, endLine)
  console.debug(`[deep-analysis-replace] clear: ${ops.length} to remove`)
  return { ops }
}
