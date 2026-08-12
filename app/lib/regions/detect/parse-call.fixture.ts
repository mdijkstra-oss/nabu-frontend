import type { Message } from "~/lib/agent/tools/apply-deep-analysis/messages"
import type { ParseCall } from "./seam"

export interface RecordedCall {
  endpoint: string
  messages: Message[]
}

export const answering = (raw: unknown): { parse: ParseCall; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = []
  const parse: ParseCall = async (endpoint, messages, schema) => {
    calls.push({ endpoint, messages })
    const parsed = schema.safeParse(raw)
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, error: parsed.error.message }
  }
  return { parse, calls }
}

export const failing =
  (error: string): ParseCall =>
  async () => ({ ok: false, error })

export const throwing =
  (error: string): ParseCall =>
  () =>
    Promise.reject(new Error(error))

export const textOf = (message: Message): string =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((part) => part.text).join("")

export const hasBreakpoint = (message: Message): boolean =>
  typeof message.content !== "string" &&
  message.content.some((part) => part.prompt_cache_breakpoint !== undefined)
