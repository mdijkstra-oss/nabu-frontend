import type { ScoutEntry } from "../scout/api"
import type { StepDefObject } from "../../derived"
import { formatSection } from "../scout/prose"

export const formatTarget = (path: string, entry: ScoutEntry): string => {
  if (entry.kind !== "mapped") return `File: ${path}\n${(entry as { content: string }).content}`

  const header = `File: ${path}`
  const body = entry.map.sections.map(formatSection).join("\n\n")
  return `${header}\n\n${body}`
}

export interface SectionMatch {
  path: string
  label: string
  startLine: number
  endLine: number
}

export interface SourceEntry {
  path: string
  scope: string
}

export const collectSections = (entries: { path: string; entry: ScoutEntry }[]): SectionMatch[] =>
  entries.flatMap(({ path, entry }) => {
    if (entry.kind !== "mapped") return []
    return entry.map.sections.map((section) => ({
      path,
      label: section.label,
      startLine: section.start_line,
      endLine: section.end_line,
    }))
  })

export const buildAutoSteps = (
  matches: SectionMatch[],
  sources: SourceEntry[],
  postAction: string
): StepDefObject[] => [
  ...matches.map((m) => toAnalysisStep(m, sources, postAction)),
  SYNTHESIS_STEP,
]

export const buildExecRules = (firstStepCall: string): string =>
  `Your only action: call the tool below. No other tool calls. No reasoning about the tool call. Execute.
   
   ${firstStepCall}`

const formatSourceArg = (sources: SourceEntry[]): string =>
  `[${sources.map((s) => `{path: "${s.path}", scope: "${s.scope}"}`).join(", ")}]`

const toAnalysisStep = (
  m: SectionMatch,
  sources: SourceEntry[],
  postAction: string
): StepDefObject => ({
  title: m.label,
  expected: `apply_deep_analysis(path="${m.path}", start_line=${m.startLine}, end_line=${m.endLine}, source_files=${formatSourceArg(sources)}, post_action="${postAction}")`,
  checkpoint: false,
})

const SYNTHESIS_STEP: StepDefObject = {
  title: "Relate to Research Questions",
  expected: `
    Write the RQ synthesis for the researcher. Annotations + codebook are your input. 150-250 words max. One or two annotation IDs per observation. No general summary. No next steps. Stop after the last RQ. Do not predict what later documents will show. Do not evaluate this document's importance relative to the corpus or research.
    Do not reference annotation ids directly, only quote the relevant parts of the text. Do not call apply_deep_analysis again.
  `,
  checkpoint: false,
}
