import type { TaskConfig } from "~/lib/agent/dispatch"
import type { CodingFileRef } from "./selectors"

// Todo run from chat too - somehow
// also llm retarted

export const codeWithFiles = (refs: CodingFileRef[]): TaskConfig => {
  const fileList = refs.map((r) => r.file).join(", ")
  const hasHidden = refs.some((r) => r.hidden)
  const hiddenNote = hasHidden
    ? " Note: .generated.hidden.md files will not appear in ls output, but do exist - DO NOT read supplied files plan deep will read for you."
    : ""
  return {
    context: `Use ls --show-tags to find codebooks, then use plan_deep_analysis to start coding of file. Do not use scout. Use the generic codebook as framework if exists AND these codebook files: ${fileList} as dimensions. Do not use any other codebooks.${hiddenNote}`,
    userMessage: `Can you code this file with ${fileList}`,
  }
}
