import type { TaskConfig } from "~/lib/agent/dispatch"
import type { FileSelectionRange } from "~/lib/editor/selection-context"
import type { CodingFileRef } from "./selectors"
import { concatPretty } from "~/lib/utils/format"

const SNIPPET_EDGE = 4
const FILE_PREVIEW_LIMIT = 3

const summarizeFiles = (paths: string[]): string => {
  if (paths.length <= FILE_PREVIEW_LIMIT) return concatPretty(paths)
  return `${paths.slice(0, FILE_PREVIEW_LIMIT).join(", ")} (+${paths.length - FILE_PREVIEW_LIMIT} more)`
}

const fileTargets = (paths: string[]): string => paths.map((p) => `{ path: "${p}" }`).join(", ")

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
  userMessage: string,
  synthesize = false
): TaskConfig => {
  const fileList = buildFileList(refs)
  const synthArg = synthesize ? `\n   - synthesize: true` : ""
  const synthTail = synthesize
    ? "\n\nAfter the tool returns, its output ends with a `## Synthesis directive` section — follow that directive to write the synthesis as your chat response."
    : ""
  return {
    context: `Follow these steps exactly:

1. Run ls --show-tags to find codebook files.
2. Call apply_deep_analysis with these exact arguments:
   - ${targetingLine}
   - ${dimensionInstruction(fileList)}
   - post_action: "annotate_as_code"${synthArg}

Do not pre-read or chunk the target files yourself — apply_deep_analysis handles fetching, chunking, and analysis internally.${buildHiddenNote(refs)}${synthTail}`,
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

export const codeWithFiles = (refs: CodingFileRef[]): TaskConfig =>
  buildDeepAnalysisNudge(
    refs,
    `targets: [${fileTargets(refs.map((r) => r.file))}] (file paths only — no start_line or end_line; the whole file will be analyzed)`,
    `Can you code this file with ${buildFileList(refs)}`,
    true
  )

const codeFile = (doc: string, dimensions: CodingFileRef[]): TaskConfig =>
  buildDeepAnalysisNudge(
    dimensions,
    `targets: [${fileTargets([doc])}] (file paths only — no start_line or end_line; the whole file will be analyzed)`,
    `Can you code this file with ${buildFileList(dimensions)}`,
    true
  )

const buildPlanCodingNudge = (docs: string[], dimensions: CodingFileRef[]): TaskConfig => ({
  context: `Follow these steps exactly:

1. Run ls --show-tags to find codebook files.
2. Call start_planning, then submit_plan with ONE step per file — ${docs.length} steps total, one for each of: ${docs.join(", ")}. Each step applies the single-file approach to exactly ONE file.
3. Execute the steps in order. For each step, call apply_deep_analysis with these exact arguments:
   - targets: [{ path: "<that step's single file>" }] (file paths only — no start_line or end_line; the whole file will be analyzed)
   - ${dimensionInstruction(buildFileList(dimensions))}
   - post_action: "annotate_as_code"
   Then call complete_step before moving to the next file.

Do not pre-read or chunk the target files yourself — apply_deep_analysis handles fetching, chunking, and analysis internally.${buildHiddenNote(dimensions)}

After every file is coded, write a brief synthesis across all of them as your chat response.`,
  userMessage: `Can you code these ${docs.length} files: ${summarizeFiles(docs)} with ${buildFileList(dimensions)}`,
})

export const codeFiles = (docs: string[], dimensions: CodingFileRef[]): TaskConfig =>
  docs.length <= 1 ? codeFile(docs[0], dimensions) : buildPlanCodingNudge(docs, dimensions)

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
})
