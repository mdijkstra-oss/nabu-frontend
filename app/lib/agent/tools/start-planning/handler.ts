import type { ToolResult } from "../../types"
import { StartPlanningArgs } from "./def"
import { registerSpecialHandler } from "../../executors/delegation"
import { pushBlocks } from "../../client/store"
import { modeSystemBlocks } from "../../executors/modes"

const executeStartPlanning = async (call: { args: unknown }): Promise<ToolResult<unknown>> => {
  const parsed = StartPlanningArgs.safeParse(call.args)
  if (!parsed.success) return { status: "error", output: `Invalid args: ${parsed.error.message}` }

  pushBlocks(modeSystemBlocks("plan"))
  return { status: "ok", output: "Planning mode." }
}

registerSpecialHandler("start_planning", executeStartPlanning)
