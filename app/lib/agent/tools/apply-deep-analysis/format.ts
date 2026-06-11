import { splitBySentences } from "~/lib/text/split"
import { extractProse } from "~/lib/data-blocks/parse"
import { stripMarkdown } from "~/lib/text/strip"
import type { PostAction } from "./def"
import type { FindResult } from "./consensus"
import type { Annotation } from "./types"

const splitSentenceTexts = splitBySentences()

export interface VoteRecord {
  find: { found: number; missed: number }
  review?: string
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

export const SECTION_MARKER = "§§ "

const isSectionMarker = (text: string): boolean => text.startsWith(SECTION_MARKER)

export const prepareTargetContent = (raw: string): string =>
  stripMarkdown(extractProse(raw), { keepHeadings: true })

export const numberSectionWithPositions = (
  text: string
): { sentences: string[]; positions: { start: number }[] } => {
  const all = splitSentenceTexts(text)
  const sentences: string[] = []
  const positions: { start: number }[] = []
  for (const s of all) {
    if (isSectionMarker(s.text)) continue
    sentences.push(s.text)
    positions.push({ start: s.start })
  }
  return { sentences, positions }
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

const formatWarnings = (warnings: string[]): string =>
  warnings.length === 0
    ? ""
    : `\n\n⚠ Degraded: ${warnings.length} model call(s) failed and were dropped. Results are based on fewer voters.\n${warnings.map((w) => `- ${w}`).join("\n")}`

export const formatReturnOutput = (
  results: MappedResult[],
  startLine: number,
  endLine: number,
  warnings: string[] = []
): string => {
  const base = results.length === 0 ? formatAbsence(startLine, endLine, "") : formatResults(results)
  return base + formatWarnings(warnings)
}

export const formatAnnotateOutput = (
  results: MappedResult[],
  action: "annotate_as_code" | "annotate_as_comment",
  startLine: number,
  endLine: number,
  warnings: string[] = []
): string => {
  if (results.length === 0)
    return formatAbsence(startLine, endLine, " No annotations written.") + formatWarnings(warnings)
  const kind = action === "annotate_as_code" ? "code" : "comment"
  const header = `${results.length} ${kind} annotation(s) written. Do not re-apply these.`
  const body = formatResults(results)
  return `${header}\n\n${body}` + formatWarnings(warnings)
}

export const isAnnotateAction = (
  action: PostAction
): action is "annotate_as_code" | "annotate_as_comment" =>
  action === "annotate_as_code" || action === "annotate_as_comment"

export const spanKey = (start: number, end: number, code: string): string =>
  `${start}-${end}-${code}`

export const countConfidence = (
  results: readonly MappedResult[]
): { confirmed: number; reviewed: number } => {
  let confirmed = 0
  let reviewed = 0
  for (const r of results) {
    if (r.vote?.review !== undefined) reviewed++
    else confirmed++
  }
  return { confirmed, reviewed }
}

export const buildSynthesisDirective = (confirmed: number, reviewed: number): string => {
  const total = confirmed + reviewed
  if (total === 0) return ""
  const ratio = confirmed / total
  const body = ratio >= 0.7 ? HIGH_CONFIDENCE : ratio >= 0.4 ? MID_CONFIDENCE : LOW_CONFIDENCE
  return `\n\n## Synthesis directive\n\n${body}`
}

const SYNTHESIS_FRAMING = `Ground every observation in source text. 1-2 quotes per pattern — the quote must directly demonstrate the pattern; if you need to explain relevance, pick a better one. Scale claims to evidence: one quote → "in at least one instance"; multiple passages → "recurrently." No exhaustive listing. Do not predict what later documents will show. Do not evaluate this document's importance relative to the corpus. Do not state confidence numbers, formulas, or which branch you took.`

const HIGH_CONFIDENCE = `${SYNTHESIS_FRAMING}

Reviewed annotations (flagged by one model, not the other) are candidates — note them as "tentatively" or "pending review", but build claims on confirmed annotations.

If Research Questions exist in the project: write a synthesis per RQ, 150-250 words each. State the pattern, then quote, then note if other passages reinforce or complicate it. Do not place a quote next to a claim it doesn't directly support.

Else: write an integrated findings section, 100-150 words. Focus on what confirmed annotations show. Note where reviewed annotations would extend the picture.`

const MID_CONFIDENCE = `${SYNTHESIS_FRAMING}

Integrated findings section, 100-150 words. Focus on what confirmed annotations show. Note where reviewed annotations would extend the picture.`

const LOW_CONFIDENCE = `${SYNTHESIS_FRAMING}

The model annotators disagreed often on this section. Write 100-150 words on what the disagreement pattern suggests about the code definition — where reviewers split, on what kind of passage.`

const countVotes = (votes: boolean[]): { found: number; missed: number } => {
  const found = votes.filter(Boolean).length
  return { found, missed: votes.length - found }
}

const annotationToVoteRecord = (a: Annotation): VoteRecord => {
  const vote: VoteRecord = {
    find: countVotes(a.findVotes),
  }
  if (a.review !== undefined) vote.review = a.review
  return vote
}

export const mapAnnotations = (sentences: string[], annotations: Annotation[]): MappedResult[] =>
  annotations.flatMap((a) => {
    const spans = sentences.slice(a.start - 1, a.end)
    if (spans.length === 0) return []
    return [
      {
        text: spans.join(" "),
        analysis_source_id: a.code,
        reason: a.reason,
        vote: annotationToVoteRecord(a),
      },
    ]
  })

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
