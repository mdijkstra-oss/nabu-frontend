import type { StepDefObject } from "../../derived"
import { CHUNK_TARGET_CHARS } from "~/lib/data-blocks/chunk-lines"

export interface LabeledTarget {
  path: string
  label: string
  desc?: string
  ranges: { startLine: number; endLine: number }[]
}

export interface SectionEntry {
  path: string
  startLine: number
  endLine: number
}

export interface SectionMatch {
  label: string
  sections: SectionEntry[]
}

export interface FileSearchGroup {
  path: string
  sections: SectionEntry[]
  totalChars: number
  resultCount: number
  bestScore: number
}

export interface SourceEntry {
  path: string
  scope: string
}

export const formatLabeledTarget = (target: LabeledTarget): string => {
  const ranges = target.ranges.map((r) => `${r.startLine}-${r.endLine}`).join(", ")
  return `[${ranges}] ${target.label}${target.desc ? `\n  ${target.desc}` : ""}`
}

export const formatTargetFile = (path: string, targets: LabeledTarget[]): string => {
  const header = `File: ${path}`
  const body = targets.map(formatLabeledTarget).join("\n\n")
  return `${header}\n\n${body}`
}

export const toSectionMatches = (labeled: LabeledTarget[]): SectionMatch[] =>
  labeled.map((t) => ({
    label: t.label,
    sections: t.ranges.map((r) => ({ path: t.path, startLine: r.startLine, endLine: r.endLine })),
  }))

export const buildAutoSteps = (
  matches: SectionMatch[],
  sources: SourceEntry[],
  postAction: string,
  interactive: boolean
): StepDefObject[] => [
  ...matches.map((m) => toSectionStep(m, sources, postAction, interactive)),
  { ...SYNTHESIS_STEP, checkpoint: interactive },
]

export const buildExecRules = (firstStepCall: string): string =>
  `Your only action: call the tool below. No other tool calls. No reasoning about the tool call. Execute.

   ${firstStepCall}`

interface Bucket {
  files: FileSearchGroup[]
  chars: number
}

const flushBucket = (bucket: Bucket): SectionMatch => {
  const sections = bucket.files.flatMap((f) => f.sections)
  const results = bucket.files.reduce((sum, f) => sum + f.resultCount, 0)
  const isSingleFile = bucket.files.length === 1
  const label = isSingleFile
    ? `${results} candidates in one file`
    : `${results} candidates across ${bucket.files.length} files`
  return { label, sections }
}

export const groupSearchSections = (files: FileSearchGroup[]): SectionMatch[] => {
  const sorted = [...files].sort((a, b) => b.bestScore - a.bestScore)
  const steps: SectionMatch[] = []
  let current: Bucket = { files: [], chars: 0 }

  for (const file of sorted) {
    const wouldOverflow =
      current.chars > 0 && current.chars + file.totalChars > CHUNK_TARGET_CHARS * 2
    if (wouldOverflow) {
      steps.push(flushBucket(current))
      current = { files: [], chars: 0 }
    }
    current.files.push(file)
    current.chars += file.totalChars
  }

  if (current.files.length > 0) steps.push(flushBucket(current))

  return steps
}

const formatSourceArg = (sources: SourceEntry[]): string =>
  `[${sources.map((s) => `{path: "${s.path}", scope: "${s.scope}"}`).join(", ")}]`

const formatSectionsArg = (m: SectionMatch): string =>
  `[${m.sections.map((s) => `{path: "${s.path}", start_line: ${s.startLine}, end_line: ${s.endLine}}`).join(", ")}]`

const autoResult = "on result: write nothing. call complete_step immediately."
const interactiveResult =
  "on result: briefly summarize key findings. use ask tool to confirm whether to continue to the next section. if yes call complete_step FIRST - else discuss and once resolved call complete_step"

const toSectionStep = (
  match: SectionMatch,
  sources: SourceEntry[],
  postAction: string,
  interactive: boolean
): StepDefObject => ({
  title: match.label,
  expected: `
    first call: apply_deep_analysis(sections=${formatSectionsArg(match)}, source_files=${formatSourceArg(sources)}, post_action="${postAction}")
    ${interactive ? interactiveResult : autoResult}
    `,
  checkpoint: interactive,
})

const SYNTHESIS_STEP: StepDefObject = {
  title: "Synthesis",
  expected: `
    Ground every observation in source text. Do not predict what later
    documents will show. Do not evaluate importance relative to the corpus.
    
    Reviewed annotations (flagged by one model, not the other) are
    candidates, not findings. Build claims on confirmed annotations.
    Reviewed ones may be noted as "tentatively" or "pending review."
    
    1-2 quotes per pattern. The quote must directly demonstrate the
    pattern — if you need to explain relevance, pick a better quote.
    Scale claims to evidence: one quote → "in at least one instance";
    multiple passages → "recurrently." No exhaustive listing.
    
    Assess confidence: confirmed / (confirmed + reviewed).
    
    If ≥ 0.7 and Research Questions exist:
      Synthesis per RQ. 150-250 words per RQ.
      State the pattern, then quote, then note if other passages
      reinforce or complicate it. Do not place a quote next to a
      claim it doesn't directly support.
      
    Else:
      Integrated findings section. Focus on what confirmed annotations
      show. Note where reviewed annotations would extend the picture.
      If confidence < 0.4, focus on what the disagreement pattern
      suggests about the code definition. 100-150 words.
`,
  checkpoint: false,
}
