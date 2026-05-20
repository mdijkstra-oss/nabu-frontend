import type { z } from "zod"
import { callLlm } from "./fetch"
import { extractText, toResponseFormat } from "./convert"

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: string }

export const cacheMarker = (): { type: "message"; role: "system"; content: string } => ({
  type: "message",
  role: "system",
  content: "<!-- cache -->",
})

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

export const callAndParse = async <T>(
  endpoint: string,
  messages: { type: "message"; role: "system" | "user"; content: string }[],
  schema: z.ZodType<T>
): Promise<CallResult<T>> => {
  const blocks = await callLlm({
    endpoint,
    messages,
    responseFormat: toResponseFormat(schema),
  })

  const text = extractText(blocks)
  if (!text) return { ok: false, error: "LLM returned no text response" }

  const raw = tryParseJson(text)
  if (raw === undefined) return { ok: false, error: "LLM returned invalid JSON" }

  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    return { ok: false, error: `Schema validation failed: ${parsed.error.message}` }

  return { ok: true, data: parsed.data }
}
