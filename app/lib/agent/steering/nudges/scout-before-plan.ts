import type { Block } from "../../client/blocks"
import {
  afterToolResult,
  isToolResult,
  isLastToolResult,
  systemNudge,
  type Nudger,
} from "../nudge-tools"

const LOOKBACK_LIMIT = 10

const hasRecentScout = (history: Block[]): boolean => {
  let seen = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const block = history[i]
    if (isToolResult(block, "compacted")) return false
    if (isToolResult(block, "scout")) return true
    seen++
    if (seen >= LOOKBACK_LIMIT) return false
  }
  return false
}

const prompt =
  "You're planning without file context. Consider using scout to load relevant files first."

export const scoutBeforePlanNudge: Nudger = (history) => {
  if (!afterToolResult(history)) return null
  if (!isLastToolResult(history, "start_planning")) return null
  if (hasRecentScout(history)) return null
  return systemNudge(prompt)
}
