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

export const codeWithSelection = (
  refs: CodingFileRef[],
  ranges: FileSelectionRange[]
): TaskConfig => {
  const fileList = concatPretty(refs.map((r) => r.file))

  const hasHidden = refs.some((r) => r.hidden)
  const hiddenNote = hasHidden
    ? "\nNote: .generated.hidden.md files will not appear in ls output, but do exist — DO NOT read supplied files, apply_deep_analysis will read them for you."
    : ""
  return {
    context: `Do NOT use scout. Follow these steps exactly:

1. Run ls --show-tags to find codebook files.
2. Call apply_deep_analysis with these exact arguments:
   - sections: [${formatSections(ranges)}]
   - source_files: use the generic codebook (scope: "framework") if it exists, AND these codebook files as dimensions (scope: "dimension"): ${fileList}. Do not use any other codebooks.
   - post_action: "annotate_as_code"${hiddenNote}`,
    userMessage: `Code selection "${snippetPreview(ranges[0].fullWords.text)}" with ${fileList}`,
  }
}

export const codeWithSearchSelection = (
  refs: CodingFileRef[],
  ranges: FileSelectionRange[],
  searchId: string
): TaskConfig => {
  const fileList = concatPretty(refs.map((r) => r.file))

  const hasHidden = refs.some((r) => r.hidden)
  const hiddenNote = hasHidden
    ? "\nNote: .generated.hidden.md files will not appear in ls output, but do exist — DO NOT read supplied files, apply_deep_analysis will read them for you."
    : ""
  return {
    context: `Do NOT use scout. Follow these steps exactly:

1. Run ls --show-tags to find codebook files.
2. Call apply_deep_analysis with these exact arguments:
   - sections: [${formatSections(ranges)}]
   - source_files: use the generic codebook (scope: "framework") if it exists, AND these codebook files as dimensions (scope: "dimension"): ${fileList}. Do not use any other codebooks.
   - post_action: "annotate_as_code"${hiddenNote}`,
    userMessage: `Code selected results from ${searchId} (${ranges.length} ${ranges.length === 1 ? "section" : "sections"}) with ${fileList}`,
  }
}

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

export const codeWithSearch = (refs: CodingFileRef[], searchId: string): TaskConfig => {
  const fileList = concatPretty(refs.map((r) => r.file))

  const hasHidden = refs.some((r) => r.hidden)
  const hiddenNote = hasHidden
    ? " Note: .generated.hidden.md files will not appear in ls output, but do exist - DO NOT read supplied files plan deep will read for you."
    : ""
  return {
    context: `Use ls --show-tags to find codebooks, then use apply_deep_analysis to code the selected results. Do not use scout. Use the generic codebook as framework if exists AND these codebook files: ${fileList} as dimensions. Do not use any other codebooks.${hiddenNote} Target the search results from ${searchId}.`,
    userMessage: `Can you code ${searchId} with ${fileList}`,
  }
}

export const codeWithFiles = (refs: CodingFileRef[]): TaskConfig => {
  const fileList = concatPretty(refs.map((r) => r.file))

  const hasHidden = refs.some((r) => r.hidden)
  const hiddenNote = hasHidden
    ? " Note: .generated.hidden.md files will not appear in ls output, but do exist - DO NOT read supplied files plan deep will read for you."
    : ""
  return {
    context: `Use ls --show-tags to find codebooks, then use apply_deep_analysis to code the file. Do not use scout. Use the generic codebook as framework if exists AND these codebook files: ${fileList} as dimensions. Do not use any other codebooks.${hiddenNote}`,
    userMessage: `Can you code this file with ${fileList}`,
  }
}
