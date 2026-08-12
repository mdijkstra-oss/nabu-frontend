import type { Message } from "./messages"
import type { ParseCall } from "~/lib/agent/client/call-parse"

export interface RecordedCall {
  endpoint: string
  messages: Message[]
}

export interface FakeParse {
  parse: ParseCall
  calls: RecordedCall[]
}

export type Respond = (endpoint: string, messages: Message[]) => unknown | Error

// The one scripted stand-in for callAndParse: records every call, answers from
// the script, and validates the answer through the call's real schema so a test
// can never assert against a response the schema would have rejected.
export const respondingWith = (respond: Respond): FakeParse => {
  const calls: RecordedCall[] = []
  const parse: ParseCall = async (endpoint, messages, schema) => {
    calls.push({ endpoint, messages })
    const raw = respond(endpoint, messages)
    if (raw instanceof Error) return { ok: false, error: raw.message }
    const parsed = schema.safeParse(raw)
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, error: parsed.error.message }
  }
  return { parse, calls }
}

export const textOf = (message: Message): string =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((part) => part.text).join("")

export const hasBreakpoint = (message: Message): boolean =>
  typeof message.content !== "string" &&
  message.content.some((part) => part.prompt_cache_breakpoint !== undefined)
