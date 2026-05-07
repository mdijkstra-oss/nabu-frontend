import { z } from "zod"
import type { Block } from "~/lib/agent/client/blocks"
import { initialParseState, processLine, stateToBlocks } from "~/lib/agent/client/parse"
import { extractText, toResponseFormat } from "~/lib/agent/client/convert"
import type { ResponseFormat } from "~/lib/agent/client/convert"
import { calculateBackoff } from "~/lib/utils/backoff"
import type { CallRecord } from "./types"

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: string }

interface LlmCallOptions {
  host: string
  endpoint: string
  messages: { type: "message"; role: "system" | "user"; content: string }[]
  responseFormat?: ResponseFormat
}

const RETRYABLE_STATUS = [429, 502, 503]
const MAX_RETRIES = 3
const STALL_TIMEOUT_MS = 30_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const isRetryable = (status: number): boolean => RETRYABLE_STATUS.includes(status)

const readWithTimeout = <T>(
  reader: ReadableStreamDefaultReader<T>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<T>> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`stall: no data for ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer))
}

const streamToBlocks = async (response: Response): Promise<Block[]> => {
  if (!response.body) throw new Error("No response body")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let state = initialParseState()

  try {
    while (true) {
      const { done, value } = await readWithTimeout(reader, STALL_TIMEOUT_MS)
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        state = processLine(line, state, {})
      }
    }

    if (buffer.trim()) {
      state = processLine(buffer, state, {})
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }

  return stateToBlocks(state)
}

const fetchWithRetry = async (url: string, body: string): Promise<Response> => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-ID": "bench" },
      body,
    })

    if (response.ok) return response

    if (!isRetryable(response.status) || attempt === MAX_RETRIES) {
      throw new Error(`LLM request failed: ${response.status}`)
    }

    const delay = calculateBackoff(attempt, { maxDelay: 10_000 })
    await sleep(delay)
  }

  throw new Error("LLM request failed: max retries exceeded")
}

export const callLlm = async ({ host, endpoint, messages, responseFormat }: LlmCallOptions): Promise<Block[]> => {
  const body: Record<string, unknown> = { messages }
  if (responseFormat) body.response_format = responseFormat

  const url = `${host}${endpoint}`
  const bodyStr = JSON.stringify(body)
  const response = await fetchWithRetry(url, bodyStr)
  return streamToBlocks(response)
}

const tryParseJson = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export const callAndParse = async <T>(
  host: string,
  endpoint: string,
  messages: { type: "message"; role: "system" | "user"; content: string }[],
  schema: z.ZodType<T>,
  calls: CallRecord[]
): Promise<CallResult<T>> => {
  const t0 = performance.now()
  const bodyStr = JSON.stringify({ messages, response_format: toResponseFormat(schema) })
  let ok = false

  try {
    const blocks = await callLlm({ host, endpoint, messages, responseFormat: toResponseFormat(schema) })
    const text = extractText(blocks)
    if (!text) return { ok: false, error: "LLM returned no text response" }

    const raw = tryParseJson(text)
    if (raw === undefined) return { ok: false, error: "LLM returned invalid JSON" }

    const parsed = schema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: `Schema validation failed: ${parsed.error.message}` }

    ok = true
    return { ok: true, data: parsed.data }
  } finally {
    calls.push({
      endpoint,
      durationMs: Math.round(performance.now() - t0),
      requestChars: bodyStr.length,
      ok,
    })
  }
}
