import type { ToolResult } from "../../types"
import { AskArgs } from "./def"
import { registerSpecialHandler } from "../../executors/delegation"
import { getAllBlocks, setLoading } from "../../client/store"
import { findLastUserContent } from "../../derived"

const executeAsk = async (call: { args: unknown }): Promise<ToolResult<unknown>> => {
  const parsed = AskArgs.safeParse(call.args)
  if (!parsed.success) return { status: "error", output: `Invalid args: ${parsed.error.message}` }

  const { waitForUser } = await import("../../executors/delegation")
  setLoading(false)
  await waitForUser()
  const answer = findLastUserContent(getAllBlocks())
  setLoading(true)

  return { status: "ok", output: answer }
}

registerSpecialHandler("ask", executeAsk)
