import type { ToolResult } from "../../types"
import { StartPlanningArgs } from "./def"
import { registerSpecialHandler } from "../../executors/delegation"

const executeStartPlanning = async (call: { args: unknown }): Promise<ToolResult<unknown>> => {
  const parsed = StartPlanningArgs.safeParse(call.args)
  if (!parsed.success) return { status: "error", output: `Invalid args: ${parsed.error.message}` }

  return { status: "ok", output: "Planning mode." }
}

registerSpecialHandler("start_planning", executeStartPlanning)
