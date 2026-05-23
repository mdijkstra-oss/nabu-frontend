import { splitBySentences } from "~/lib/text/split"
import { extractProse } from "~/lib/data-blocks/parse"
import { stripMarkdown } from "~/lib/text/strip"
import type { PostAction } from "./def"
import type { FindResult } from "./consensus"
import type { Annotation } from "./types"

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

export const extractSentenceContext = (
  content: string,
  startLine: number,
  endLine: number,
  n: number
): { leading: string; trailing: string } => {
  if (n <= 0) return { leading: "", trailing: "" }
  const lines = content.split("\n")

  const leadingRaw = lines.slice(0, startLine - 1).join("\n")
  const leadingPrepared = prepareTargetContent(leadingRaw)
  const leadingSentences = splitSentenceTexts(leadingPrepared).map((s) => s.text)
  const leading = leadingSentences.slice(-n).join(" ")

  const trailingRaw = lines.slice(endLine).join("\n")
  const trailingPrepared = prepareTargetContent(trailingRaw)
  const trailingSentences = splitSentenceTexts(trailingPrepared).map((s) => s.text)
  const trailing = trailingSentences.slice(0, n).join(" ")

  return { leading, trailing }
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

export const prepareTargetContent = (raw: string): string =>
  stripMarkdown(extractProse(raw), { keepHeadings: true })

const splitSentenceTexts = splitBySentences()

const isSectionMarker = (text: string): boolean => text.startsWith(SECTION_MARKER)

export const numberSection = (text: string): { sentences: string[]; numbered: string } => {
  const all = splitSentenceTexts(text)
  const sentences: string[] = []
  const lines: string[] = []
  for (const s of all) {
    if (isSectionMarker(s.text)) {
      lines.push(s.text)
    } else {
      sentences.push(s.text)
      lines.push(`${sentences.length}: ${s.text}`)
    }
  }
  return { sentences, numbered: lines.join("\n") }
}

export const numberSectionWithPositions = (
  text: string
): { sentences: string[]; numbered: string; positions: { start: number }[] } => {
  const all = splitSentenceTexts(text)
  const sentences: string[] = []
  const positions: { start: number }[] = []
  const lines: string[] = []
  for (const s of all) {
    if (isSectionMarker(s.text)) {
      lines.push(s.text)
    } else {
      sentences.push(s.text)
      positions.push({ start: s.start })
      lines.push(`${sentences.length}: ${s.text}`)
    }
  }
  return { sentences, numbered: lines.join("\n"), positions }
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

interface CodeCoverage {
  code: string
  chars: number
}

const computeCodeCoverages = (results: MappedResult[]): CodeCoverage[] => {
  const byCode = new Map<string, number>()
  for (const r of results) {
    const prev = byCode.get(r.analysis_source_id) ?? 0
    byCode.set(r.analysis_source_id, prev + r.text.length)
  }
  return Array.from(byCode, ([code, chars]) => ({ code, chars }))
}

const formatPct = (chars: number, total: number): string => `${Math.round((chars / total) * 100)}%`

export const formatCoverage = (results: MappedResult[], sectionTextLength: number): string => {
  if (results.length === 0 || sectionTextLength === 0) return ""
  const coverages = computeCodeCoverages(results)
  const totalChars = coverages.reduce((sum, c) => sum + c.chars, 0)
  const breakdown = coverages
    .map((c) => `${c.code}: ${formatPct(c.chars, sectionTextLength)}`)
    .join(", ")
  return `Coverage: ${formatPct(totalChars, sectionTextLength)} of text — ${breakdown}`
}

export const formatReturnOutput = (
  results: MappedResult[],
  startLine: number,
  endLine: number,
  sectionTextLength: number,
  warnings: string[] = []
): string => {
  const coverage = formatCoverage(results, sectionTextLength)
  const base = results.length === 0 ? formatAbsence(startLine, endLine, "") : formatResults(results)
  const withCoverage = coverage ? `${coverage}\n\n${base}` : base
  return withCoverage + formatWarnings(warnings)
}

export const formatAnnotateOutput = (
  results: MappedResult[],
  action: "annotate_as_code" | "annotate_as_comment",
  startLine: number,
  endLine: number,
  sectionTextLength: number,
  warnings: string[] = []
): string => {
  if (results.length === 0)
    return formatAbsence(startLine, endLine, " No annotations written.") + formatWarnings(warnings)
  const coverage = formatCoverage(results, sectionTextLength)
  const kind = action === "annotate_as_code" ? "code" : "comment"
  const header = `${results.length} ${kind} annotation(s) written. Do not re-apply these.`
  const body = formatResults(results)
  const withCoverage = coverage ? `${coverage}\n\n${header}\n\n${body}` : `${header}\n\n${body}`
  return withCoverage + formatWarnings(warnings)
}

export const isAnnotateAction = (
  action: PostAction
): action is "annotate_as_code" | "annotate_as_comment" =>
  action === "annotate_as_code" || action === "annotate_as_comment"

export const spanKey = (start: number, end: number, code: string): string =>
  `${start}-${end}-${code}`

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
