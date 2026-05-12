import type { TaskConfig } from "~/lib/agent/dispatch"
import type { CodingFileRef } from "./selectors"

const concatPretty = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} & ${items.at(-1)}`

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
