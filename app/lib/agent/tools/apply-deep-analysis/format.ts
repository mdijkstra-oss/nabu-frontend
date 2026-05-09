import { splitBySentences } from "~/lib/text/split"
import { formatNumberedPassage } from "~/lib/text/format"
import { extractProse } from "~/lib/data-blocks/parse"
import { stripMarkdown } from "~/lib/text/strip"
import { findMatches } from "~/lib/patch/diff/search"
import type { PostAction } from "./def"
import type { FindResult } from "./consensus"

export interface VoteRecord {
  find: { found: number; missed: number }
  filter: { keep: number; remove: number }
  removalJustification: string | null
}

export interface AnalysisResult {
  start: number
  end: number
  analysis_source_id: string
  reason: string
  vote?: VoteRecord
}

export interface MappedResult {
  text: string
  analysis_source_id: string
  reason: string
  vote?: VoteRecord
}

export interface AnnotationRef {
  id?: string
  code?: string
  text: string
}

export interface RemoveAnnotationOp {
  op: "remove_annotation"
  match: { id: string }
}

export const extractSection = (content: string, startLine: number, endLine: number): string => {
  const lines = content.split("\n")
  return lines.slice(startLine - 1, endLine).join("\n")
}

export const extractLeadingContext = (
  content: string,
  startLine: number,
  maxChars: number
): string => {
  if (startLine <= 1 || maxChars <= 0) return ""
  const lines = content.split("\n")
  const preceding = lines.slice(0, startLine - 1)

  let chars = 0
  for (let i = preceding.length - 1; i >= 0; i--) {
    chars += preceding[i].length + 1
    if (chars >= maxChars) return preceding.slice(i).join("\n").trim()
  }
  return preceding.join("\n").trim()
}

export const extractTrailingContext = (
  content: string,
  endLine: number,
  maxChars: number
): string => {
  const lines = content.split("\n")
  if (endLine >= lines.length || maxChars <= 0) return ""
  const following = lines.slice(endLine)

  let chars = 0
  for (let i = 0; i < following.length; i++) {
    chars += following[i].length + 1
    if (chars >= maxChars)
      return following
        .slice(0, i + 1)
        .join("\n")
        .trim()
  }
  return following.join("\n").trim()
}

export const prepareTargetContent = (raw: string): string =>
  stripMarkdown(extractProse(raw), { keepHeadings: true })

const splitSentenceTexts = splitBySentences()

export const numberSection = (text: string): { sentences: string[]; numbered: string } => {
  const sentences = splitSentenceTexts(text).map((s) => s.text)
  return { sentences, numbered: formatNumberedPassage(sentences) }
}

export const mapResults = (sentences: string[], results: AnalysisResult[]): MappedResult[] =>
  results.flatMap((r) => {
    const spans = sentences.slice(r.start - 1, r.end)
    if (spans.length === 0) return []
    return [
      {
        text: spans.join(" "),
        analysis_source_id: r.analysis_source_id,
        reason: r.reason,
        vote: r.vote,
      },
    ]
  })

interface AddAnnotationOp {
  op: "add_annotation"
  item: {
    text: string
    reason: string
    code?: string
    color?: string
    vote?: VoteRecord
  }
}

const DEFAULT_COMMENT_COLOR = "blue"

const toCodeAnnotation = (result: MappedResult): AddAnnotationOp => ({
  op: "add_annotation",
  item: {
    text: result.text,
    reason: result.reason,
    code: result.analysis_source_id,
    vote: result.vote,
  },
})

const toCommentAnnotation = (result: MappedResult): AddAnnotationOp => ({
  op: "add_annotation",
  item: {
    text: result.text,
    reason: `[${result.analysis_source_id}] ${result.reason}`,
    color: DEFAULT_COMMENT_COLOR,
    vote: result.vote,
  },
})

const annotationBuilders: Record<
  "annotate_as_code" | "annotate_as_comment",
  (r: MappedResult) => AddAnnotationOp
> = {
  annotate_as_code: toCodeAnnotation,
  annotate_as_comment: toCommentAnnotation,
}

export const toAnnotationOps = (
  results: MappedResult[],
  action: "annotate_as_code" | "annotate_as_comment"
): AddAnnotationOp[] => results.map(annotationBuilders[action])

const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart <= bEnd && bStart <= aEnd

export const buildRemovalOps = (
  annotations: readonly AnnotationRef[],
  content: string,
  codes: ReadonlySet<string>,
  startLine: number,
  endLine: number
): RemoveAnnotationOp[] => {
  const sectionStart = startLine - 1
  const sectionEnd = endLine - 1
  return annotations.flatMap((a) => {
    if (!a.id || !a.code || !codes.has(a.code)) return []
    const matches = findMatches(content, a.text)
    if (matches.length === 0) return []
    const overlaps = matches.some((m) => rangesOverlap(m.start, m.end, sectionStart, sectionEnd))
    return overlaps ? [{ op: "remove_annotation" as const, match: { id: a.id } }] : []
  })
}

const formatResult = (r: MappedResult): string =>
  `- [${r.analysis_source_id}] "${r.text}": ${r.reason}`

const formatResults = (results: MappedResult[]): string => results.map(formatResult).join("\n")

export const ABSENCE_HINT = [
  "\n-----",
  "Absence is data. Report that nothing was found in this section.",
  "Do not speculate about why — the analysis was exhaustive.",
  "If the user asks why, re-examine the source definitions and section content.",
].join("\n")

const formatAbsence = (startLine: number, endLine: number, suffix: string): string =>
  `Lines ${startLine}-${endLine} analyzed. No matches found.${suffix}${ABSENCE_HINT}`

export const formatReturnOutput = (
  results: MappedResult[],
  startLine: number,
  endLine: number
): string => (results.length === 0 ? formatAbsence(startLine, endLine, "") : formatResults(results))

export const formatAnnotateOutput = (
  results: MappedResult[],
  action: "annotate_as_code" | "annotate_as_comment",
  startLine: number,
  endLine: number
): string => {
  if (results.length === 0) return formatAbsence(startLine, endLine, " No annotations written.")
  const kind = action === "annotate_as_code" ? "code" : "comment"
  return `${results.length} ${kind} annotation(s) written. Do not re-apply these.\n\n${formatResults(results)}`
}

export const isAnnotateAction = (
  action: PostAction
): action is "annotate_as_code" | "annotate_as_comment" =>
  action === "annotate_as_code" || action === "annotate_as_comment"

export const spanKey = (start: number, end: number, code: string): string =>
  `${start}-${end}-${code}`

export const toAnalysisResults = (
  spans: FindResult[],
  reasons: Map<string, string>,
  votes?: Map<string, VoteRecord>
): AnalysisResult[] =>
  spans.map((s) => {
    const key = spanKey(s.start, s.end, s.analysis_source_id)
    return {
      start: s.start,
      end: s.end,
      analysis_source_id: s.analysis_source_id,
      reason: reasons.get(key) ?? "",
      vote: votes?.get(key),
    }
  })
