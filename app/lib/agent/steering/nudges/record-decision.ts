import type { Block } from "../../client/blocks"
import {
  isToolResult,
  systemNudge,
  withCooldown,
  findToolCallArgs,
  type Nudger,
} from "../nudge-tools"

const isNonLocalScope = (args: Record<string, unknown>): boolean =>
  args.scope === "codebook" || args.scope === "preferences"

const hasUnrecordedAsk = (history: Block[]): boolean => {
  for (let i = history.length - 1; i >= 0; i--) {
    const block = history[i]
    if (isToolResult(block, "record_decision")) return false
    if (isToolResult(block, "ask")) {
      const args = findToolCallArgs(history, (block as { callId?: string }).callId ?? "")
      if (args && isNonLocalScope(args)) return true
    }
  }
  return false
}

const prompt = `There are unrecorded codebook/preferences decisions from earlier ask exchanges. Once the discussion has converged, call record_decision to persist them.`

const baseNudge: Nudger = (history) => (hasUnrecordedAsk(history) ? systemNudge(prompt) : null)

export const recordDecisionNudge: Nudger = withCooldown(6, baseNudge)
