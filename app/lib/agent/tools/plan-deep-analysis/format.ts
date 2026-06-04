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

export interface ScoredSection {
  section: SectionEntry
  chars: number
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

const firstStartLine = (t: LabeledTarget): number => t.ranges[0]?.startLine ?? 0

export const sortLabeledByInputOrder = (
  labeled: readonly LabeledTarget[],
  inputPaths: readonly string[]
): LabeledTarget[] => {
  const pathOrder = new Map(inputPaths.map((p, i) => [p, i]))
  const indexOf = (path: string): number => pathOrder.get(path) ?? Number.MAX_SAFE_INTEGER
  return [...labeled].sort((a, b) => {
    const pa = indexOf(a.path)
    const pb = indexOf(b.path)
    if (pa !== pb) return pa - pb
    return firstStartLine(a) - firstStartLine(b)
  })
}

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

const bucketLabel = (sections: SectionEntry[]): string => {
  const files = new Set(sections.map((s) => s.path))
  return files.size === 1
    ? `${sections.length} candidates in one file`
    : `${sections.length} candidates across ${files.size} files`
}

export const bucketSearchSections = (scored: ScoredSection[]): SectionMatch[] => {
  const steps: SectionMatch[] = []
  let current: SectionEntry[] = []
  let chars = 0

  for (const { section, chars: sectionChars } of scored) {
    const wouldOverflow = chars > 0 && chars + sectionChars > CHUNK_TARGET_CHARS * 2
    if (wouldOverflow) {
      steps.push({ label: bucketLabel(current), sections: current })
      current = []
      chars = 0
    }
    current.push(section)
    chars += sectionChars
  }

  if (current.length > 0) steps.push({ label: bucketLabel(current), sections: current })

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
    This ratio and the 0.7 threshold are internal deliberation only.
    Do not state the number, the formula, or the branch you took in
    the output. The reader sees synthesis, not the scoring mechanism.

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
