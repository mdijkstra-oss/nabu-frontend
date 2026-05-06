import type { Block } from "../../client/blocks"
import { afterToolResult, isLastToolResult, systemNudge, type Nudger } from "../nudge-tools"

const extractScoutContext = (history: Block[]): string => {
  let fileCount = 0
  let sectionCount = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const block = history[i]
    if (block.type === "system" && block.content.startsWith("File: ")) {
      fileCount++
      const sections = (block.content.match(/"label"/g) ?? []).length
      sectionCount += sections
    }
    if (block.type === "tool_call") break
  }
  const parts = [`${fileCount} file${fileCount === 1 ? "" : "s"}`]
  if (sectionCount > 0) parts.push(`${sectionCount} section${sectionCount === 1 ? "" : "s"}`)
  return parts.join(", ")
}

const prompt = `Scout loaded {context}.
Review the section map — you decide which sections are in scope.
Does this task apply a shared framework, codebook, or analytical criteria — or require sequential attention across sections?
Yes: use start_planning.
No: proceed directly.`

export const planAfterScoutNudge: Nudger = (history) => {
  if (!afterToolResult(history)) return null
  if (!isLastToolResult(history, "scout")) return null

  const context = extractScoutContext(history)
  return systemNudge(prompt.replace("{context}", context))
}
