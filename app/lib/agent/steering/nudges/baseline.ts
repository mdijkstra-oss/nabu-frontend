import type { Block } from "../../client/blocks"
import { combine, emptyNudge, type Nudger } from "../nudge-tools"

const lastBlock = (history: Block[]): Block | undefined => history[history.length - 1]

const afterToolResult: Nudger = (history) => {
  if (lastBlock(history)?.type !== "tool_result") return null
  return emptyNudge()
}

const afterUserMessage: Nudger = (history) => {
  if (lastBlock(history)?.type !== "user") return null
  return emptyNudge()
}

const afterSystemBlock: Nudger = (history) => {
  if (lastBlock(history)?.type !== "system") return null
  return emptyNudge()
}

export const baselineNudge: Nudger = combine(afterToolResult, afterUserMessage, afterSystemBlock)
