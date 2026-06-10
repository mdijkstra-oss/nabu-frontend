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
    `sections: [${formatSections(ranges)}]`,
    `Code selection "${snippetPreview(ranges[0].fullWords.text)}" with ${buildFileList(refs)}`
  )

export const codeWithSearchSelection = (
  refs: CodingFileRef[],
  ranges: FileSelectionRange[],
  searchId: string
): TaskConfig =>
  buildDeepAnalysisNudge(
    refs,
    `sections: [${formatSections(ranges)}]`,
    `Code selected results from ${searchId} (${ranges.length} ${ranges.length === 1 ? "section" : "sections"}) with ${buildFileList(refs)}`
  )

export const codeWithFiles = (refs: CodingFileRef[]): TaskConfig =>
  buildDeepAnalysisNudge(
    refs,
    `sections: [${refs.map((r) => `{ path: "${r.file}" }`).join(", ")}] (file paths only — no start_line or end_line; the whole file will be analyzed)`,
    `Can you code this file with ${buildFileList(refs)}`
  )

export const codeWithSearch = (refs: CodingFileRef[], searchId: string): TaskConfig =>
  buildDeepAnalysisNudge(
    refs,
    `search_id: "${searchId}" (do not pass sections — the search's hits are resolved automatically to file paths and line ranges)`,
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
