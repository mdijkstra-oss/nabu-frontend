import type { ToolCall, ToolResultBlock } from "./client/blocks"
import type { ToolResult } from "./types"
import { isAbortError } from "~/lib/utils/error"

export type ToolExecutor = (call: ToolCall) => Promise<ToolResult<unknown>>

const MAX_ERROR_OUTPUT = 600

export const trimErrorOutput = (output: string): string =>
  output.length <= MAX_ERROR_OUTPUT ? output : output.slice(0, MAX_ERROR_OUTPUT) + "…"

const trimResult = (res: ToolResult<unknown>): ToolResult<unknown> =>
  res.status === "error" ? { ...res, output: trimErrorOutput(res.output) } : res

const logToolResult = (call: ToolCall, res: ToolResult<unknown>): void => {
  const log = res.status === "ok" ? console.debug : console.warn
  log(`[TOOL ${call.name}]`, { call, ...res })
}

const CANCELED_MESSAGE = "Canceled by user"

const toCanceledResult = (): ToolResult<unknown> => ({
  status: "error",
  output: CANCELED_MESSAGE,
})

const toErrorResult = (e: unknown): ToolResult<unknown> => {
  if (isAbortError(e)) return toCanceledResult()
  return { status: "error", output: e instanceof Error ? e.message : String(e) }
}

export const canceledToolResult = (call: ToolCall): ToolResultBlock => ({
  type: "tool_result",
  callId: call.id,
  toolName: call.name,
  result: toCanceledResult(),
})

export const executeTool = async (
  call: ToolCall,
  execute: ToolExecutor
): Promise<ToolResultBlock> => {
  const res = trimResult(await execute(call).catch(toErrorResult))
  logToolResult(call, res)
  return { type: "tool_result", callId: call.id, toolName: call.name, result: res }
}
