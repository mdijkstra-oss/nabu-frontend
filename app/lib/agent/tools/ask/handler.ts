import type { ToolResult } from "../../types"
import { AskArgs, type AskOption } from "./def"
import { registerSpecialHandler } from "../../executors/delegation"
import { getAllBlocks, setLoading } from "../../client/store"
import { findLastUserContent } from "../../derived"

const findSelectedExpected = (options: AskOption[], answer: string): string | null => {
  const match = options.find((o) => o.label === answer)
  return match?.expected ?? null
}

const executeAsk = async (call: { args: unknown }): Promise<ToolResult<unknown>> => {
  const parsed = AskArgs.safeParse(call.args)
  if (!parsed.success) return { status: "error", output: `Invalid args: ${parsed.error.message}` }

  const { waitForUser } = await import("../../executors/delegation")
  setLoading(false)
  await waitForUser()
  const answer = findLastUserContent(getAllBlocks())
  setLoading(true)

  const output = findSelectedExpected(parsed.data.options, answer) ?? answer
  return { status: "ok", output }
}

registerSpecialHandler("ask", executeAsk)
