import type { TaskConfig } from "~/lib/agent/dispatch"
import type { CodingFileRef } from "./selectors"
import { concatPretty } from "~/lib/utils/format"

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
  userMessage: `Diagnose the code definition for ${codeId}`,
  guidance: "qual-coding/codebook/refine",
})

export const codeWithQuery = (refs: CodingFileRef[], sql: string): TaskConfig => {
  const fileList = concatPretty(refs.map((r) => r.file))

  const hasHidden = refs.some((r) => r.hidden)
  const hiddenNote = hasHidden
    ? " Note: .generated.hidden.md files will not appear in ls output, but do exist - DO NOT read supplied files plan deep will read for you."
    : ""
  return {
    context: `Use ls --show-tags to find codebooks, then use plan_deep_analysis to start coding of file. Do not use scout. Use the generic codebook as framework if exists AND these codebook files: ${fileList} as dimensions. Do not use any other codebooks.${hiddenNote} Use target_files: [{ type: "query", sql: "${sql.replace(/"/g, '\\"')}" }] instead of file paths.`,
    userMessage: `Can you code search results with ${fileList}`,
  }
}

export const codeWithFiles = (refs: CodingFileRef[]): TaskConfig => {
  const fileList = concatPretty(refs.map((r) => r.file))

  const hasHidden = refs.some((r) => r.hidden)
  const hiddenNote = hasHidden
    ? " Note: .generated.hidden.md files will not appear in ls output, but do exist - DO NOT read supplied files plan deep will read for you."
    : ""
  return {
    context: `Use ls --show-tags to find codebooks, then use plan_deep_analysis to start coding of file. Do not use scout. Use the generic codebook as framework if exists AND these codebook files: ${fileList} as dimensions. Do not use any other codebooks.${hiddenNote}`,
    userMessage: `Can you code this file with ${fileList}`,
  }
}
