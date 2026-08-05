import type { z } from "zod"
import { callLlm } from "./fetch"
import { extractText, toResponseFormat } from "./convert"
import type { MessageContent } from "./convert"

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: string }

const CODE_FENCE_RE = /^```\w*\n([\s\S]*)\n```\s*$/

const stripCodeFence = (text: string): string => {
  const match = CODE_FENCE_RE.exec(text.trim())
  return match ? match[1] : text
}

export const tryParseJson = (text: string): unknown | undefined => {
  try {
    return JSON.parse(stripCodeFence(text))
  } catch {
    return undefined
  }
}

const PARSE_RETRIES = 1

const attemptParse = <T>(text: string, schema: z.ZodType<T>): CallResult<T> => {
  const raw = tryParseJson(text)
  if (raw === undefined) return { ok: false, error: "LLM returned invalid JSON" }

  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    return { ok: false, error: `Schema validation failed: ${parsed.error.message}` }

  return { ok: true, data: parsed.data }
}

export const callAndParse = async <T>(
  endpoint: string,
  messages: { type: "message"; role: "system" | "user"; content: MessageContent }[],
  schema: z.ZodType<T>
): Promise<CallResult<T>> => {
  const responseFormat = toResponseFormat(schema)

  for (let attempt = 0; attempt <= PARSE_RETRIES; attempt++) {
    const blocks = await callLlm({ endpoint, messages, responseFormat })
    const text = extractText(blocks)
    if (!text) return { ok: false, error: "LLM returned no text response" }

    const result = attemptParse(text, schema)
    if (result.ok) return result

    if (attempt < PARSE_RETRIES) {
      console.warn(`[callAndParse ${endpoint}] ${result.error}, retry ${attempt + 1}`)
      continue
    }

    return result
  }

  return { ok: false, error: "unreachable" }
}
