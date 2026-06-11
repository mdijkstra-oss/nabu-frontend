import type { TaskConfig } from "~/lib/agent/dispatch"
import type { FileSelectionRange } from "~/lib/editor/selection-context"
import type { CodingFileRef } from "./selectors"
import { concatPretty } from "~/lib/utils/format"

const SNIPPET_EDGE = 4

const snippetPreview = (text: string): string => {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= SNIPPET_EDGE * 2) return words.join(" ")
  return `${words.slice(0, SNIPPET_EDGE).join(" ")} … ${words.slice(-SNIPPET_EDGE).join(" ")}`
}

const formatSections = (ranges: FileSelectionRange[]): string =>
  ranges
    .map(
      (r) => `{ path: "${r.filePath}", start_line: ${r.startLine + 1}, end_line: ${r.endLine + 1} }`
    )
    .join(", ")

const buildFileList = (refs: CodingFileRef[]): string => concatPretty(refs.map((r) => r.file))

const buildHiddenNote = (refs: CodingFileRef[]): string =>
  refs.some((r) => r.hidden)
    ? "\nNote: .generated.hidden.md files will not appear in ls output, but do exist — DO NOT read supplied files, apply_deep_analysis will read them for you."
    : ""

const dimensionInstruction = (fileList: string): string =>
  `source_files: use the generic codebook (scope: "framework") if it exists, AND these codebook files as dimensions (scope: "dimension"): ${fileList}. Do not use any other codebooks.`

const buildDeepAnalysisNudge = (
  refs: CodingFileRef[],
  targetingLine: string,
  userMessage: string
): TaskConfig => {
  const fileList = buildFileList(refs)
  return {
    context: `Follow these steps exactly:

1. Run ls --show-tags to find codebook files.
2. Call apply_deep_analysis with these exact arguments:
   - ${targetingLine}
   - ${dimensionInstruction(fileList)}
   - post_action: "annotate_as_code"

Do not pre-read or chunk the target files yourself — apply_deep_analysis handles fetching, chunking, and analysis internally.${buildHiddenNote(refs)}`,
    userMessage,
  }
}

export const codeWithSelection = (
  refs: CodingFileRef[],
  ranges: FileSelectionRange[]
): TaskConfig =>
  buildDeepAnalysisNudge(
    refs,
    `targets: [${formatSections(ranges)}]`,
    `Code selection "${snippetPreview(ranges[0].fullWords.text)}" with ${buildFileList(refs)}`
  )

export const codeWithSearchSelection = (
  refs: CodingFileRef[],
  ranges: FileSelectionRange[],
  searchId: string
): TaskConfig =>
  buildDeepAnalysisNudge(
    refs,
    `targets: [${formatSections(ranges)}]`,
    `Code selected results from ${searchId} (${ranges.length} ${ranges.length === 1 ? "section" : "sections"}) with ${buildFileList(refs)}`
  )

const SYNTHESIS_EXPECTED = `
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
      suggests about the code definition. 100-150 words.`

const buildCodingStepExpected = (refs: CodingFileRef[]): string => {
  const fileList = buildFileList(refs)
  const targetsArg = `[${refs.map((r) => `{path: "${r.file}"}`).join(", ")}]`
  return `first call: apply_deep_analysis(targets=${targetsArg}, ${dimensionInstruction(fileList)}, post_action="annotate_as_code")
    targets are file paths only — no start_line or end_line; the whole file will be analyzed.
    on result: write nothing. call complete_step immediately.`
}

export const codeWithFiles = (refs: CodingFileRef[]): TaskConfig => {
  const fileList = buildFileList(refs)
  return {
    context: `Follow these steps exactly:

1. Run ls --show-tags to find codebook files.
2. Call start_planning with task: "Code ${fileList}".
3. Immediately call submit_plan with EXACTLY 2 steps (do not discuss with the user first):
   - Step 1, title: "Code ${fileList}", checkpoint: false, expected:
${buildCodingStepExpected(refs)}
   - Step 2, title: "Synthesis", checkpoint: false, expected:
${SYNTHESIS_EXPECTED}
4. Execute the plan.

Do not pre-read or chunk the target files yourself — apply_deep_analysis handles fetching, chunking, and analysis internally.${buildHiddenNote(refs)}`,
    userMessage: `Can you code this file with ${fileList}`,
  }
}

export const codeWithSearch = (refs: CodingFileRef[], searchId: string): TaskConfig =>
  buildDeepAnalysisNudge(
    refs,
    `search_id: "${searchId}" (do not pass targets — the search's hits are resolved automatically to file paths and line ranges)`,
    `Can you code ${searchId} with ${buildFileList(refs)}`
  )

export const buildRefineTask = (codeId: string): TaskConfig => ({
  context: `
Important: Do not analyze, interpret, or evaluate code definitions yourself. refine_code handles all analytical work.

Do NOT question these next steps, they come DIRECTLY from user. Do every step in order NOW.

1. Use ls --show-tags to find the general codebook file (group: "framework").
2. Call refine_code with:
   - file path: the codebook found in step 1
   - callout_id: "${codeId}"
3. Present the findings to the researcher and discuss next steps.
`,
  userMessage: `Refine the code definition for ${codeId}`,
  guidance: "qual-coding/codebook/refine",
})
