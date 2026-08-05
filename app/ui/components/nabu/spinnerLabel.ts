import type { Block } from "~/lib/agent/client/blocks"

export const LABEL_ADVANCE_MS = 4000

const WRITING_LABELS = ["Writing", "Editing", "Applying changes"]
const REMOVING_LABELS = ["Removing", "Cleaning up", "Tidying"]

const toolLabels: Record<string, string[]> = {
  run_local_shell: ["Reading", "Examining files", "Processing"],
  patch_attributes: WRITING_LABELS,
  patch_annotations: WRITING_LABELS,
  patch_callout: WRITING_LABELS,
  patch_settings: WRITING_LABELS,
  patch_chart: WRITING_LABELS,
  delete_attributes: REMOVING_LABELS,
  delete_annotations: REMOVING_LABELS,
  delete_callout: REMOVING_LABELS,
  delete_settings: REMOVING_LABELS,
  delete_chart: REMOVING_LABELS,
  edit_file: WRITING_LABELS,
  create_file: WRITING_LABELS,
  copy_file: WRITING_LABELS,
  rename_file: WRITING_LABELS,
  remove_file: REMOVING_LABELS,
  apply_deep_analysis: ["Analyzing section", "Applying criteria", "Running deep analysis"],
  start_planning: ["Planning", "Preparing approach", "Laying groundwork"],
  submit_plan: ["Starting execution", "Locking in plan", "Transitioning"],
  complete_step: ["Working", "Making progress", "Finishing up"],
  cancel: ["Cancelling", "Winding down", "Stepping back"],
  search: ["Looking around", "Searching documents", "Analyzing results"],
  query: ["Examining data", "Querying", "Processing results"],
  refine_code: [
    "Reviewing code",
    "Comparing passages",
    "Refining definition",
    "Analyzing patterns",
  ],
  ask: ["Asking", "Waiting for answer", "Checking in"],
}

const DEFAULT_LABELS: string[] = ["Thinking"]

const toLabels = (toolName: string | null): string[] => {
  if (!toolName) return DEFAULT_LABELS
  return toolLabels[toolName] ?? DEFAULT_LABELS
}

const findLastBoldText = (text: string): string | null => {
  const matches = [...text.matchAll(/\*\*(.+?)\*\*/g)]
  return matches.length > 0 ? matches[matches.length - 1][1].trim() : null
}

const blockToSpinnerLabels = (block: Block): string[] | null => {
  if (block.type === "progress") return [block.label]
  if (block.type === "reasoning") {
    const bold = findLastBoldText(block.content)
    return [bold ?? "Thinking"]
  }
  if (block.type === "tool_call" && block.calls.length > 0)
    return toLabels(block.calls[block.calls.length - 1].name)
  if (block.type === "tool_result") return toLabels(block.toolName ?? null)
  return null
}

const findTurnStart = (history: Block[]): number => {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].type === "user") return i + 1
  }
  return 0
}

export const getSpinnerLabels = (history: Block[], draft: Block | null): string[] => {
  if (draft) {
    const labels = blockToSpinnerLabels(draft)
    if (labels) return labels
  }
  const turnStart = findTurnStart(history)
  for (let i = history.length - 1; i >= turnStart; i--) {
    const labels = blockToSpinnerLabels(history[i])
    if (labels) return labels
  }
  return DEFAULT_LABELS
}
