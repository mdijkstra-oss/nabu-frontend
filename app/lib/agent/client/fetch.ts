import type { Block, ErrorBlock } from "./blocks"
import type { ToolDefinition } from "../executors/tool"
import type { BlockSchemaDefinition } from "~/lib/data-blocks/json-schema"
import { getLlmHost, getLlmHeaders } from "~/lib/agent/env"
import { getActiveSignal } from "~/lib/utils/signal"
import { calculateBackoff } from "~/lib/utils/backoff"
import { initialParseState, processLine, stateToBlocks, type ParseCallbacks } from "./parse"
import { toSystem } from "./convert"
import type { InputItem, ResponseFormat } from "./convert"
import { startRawCall, completeRawCall, updateRawCallStream } from "./raw-store"
import { buildKey, tryGet, tryPut } from "~/lib/utils/storage-cache"

const RETRYABLE_STATUS = [429, 502, 503]
const MAX_RETRIES = 3
const MAX_FILTER_RETRIES = 2
const STALL_TIMEOUT_MS = 120_000
const CONNECT_TIMEOUT_MS = 30_000

const RETRYABLE_ERROR_TYPES = new Set(["SAFETY", "RECITATION", "content_filter"])

const findRetryableError = (blocks: Block[]): ErrorBlock | undefined =>
  blocks.find(
    (b): b is ErrorBlock => b.type === "error" && RETRYABLE_ERROR_TYPES.has(b.errorType ?? "")
  )

export class StallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StallError"
  }
}

export class ConnectTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConnectTimeoutError"
  }
}

const isStallError = (err: unknown): err is StallError => err instanceof StallError

const isUserAbort = (signal?: AbortSignal): boolean =>
  signal?.aborted === true || getActiveSignal()?.aborted === true

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const isRetryable = (status: number): boolean => RETRYABLE_STATUS.includes(status)

interface FetchOptions {
  url: string
  body: string
  signal?: AbortSignal
}

const isSignal = (s: AbortSignal | null | undefined): s is AbortSignal => s != null

const combineSignals = (...signals: (AbortSignal | null | undefined)[]): AbortSignal =>
  AbortSignal.any(signals.filter(isSignal))

const fetchWithRetry = async ({ url, body, signal }: FetchOptions): Promise<Response> => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const connectController = new AbortController()
    const timer = setTimeout(() => connectController.abort(), CONNECT_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: getLlmHeaders(),
        body,
        signal: combineSignals(connectController.signal, signal, getActiveSignal()),
      })
      clearTimeout(timer)

      if (response.ok) return response

      if (!isRetryable(response.status) || attempt === MAX_RETRIES) {
        throw new Error(`LLM request failed: ${response.status}`)
      }
    } catch (err) {
      clearTimeout(timer)
      if (connectController.signal.aborted && !isUserAbort(signal)) {
        throw new ConnectTimeoutError(
          `no response from backend within ${CONNECT_TIMEOUT_MS / 1000}s — model may be out of quota`
        )
      }
      throw err
    }

    const delay = calculateBackoff(attempt, { maxDelay: 10000 })
    await sleep(delay)
  }

  throw new Error("LLM request failed: max retries exceeded")
}

const readWithTimeout = <T>(
  reader: ReadableStreamDefaultReader<T>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<T>> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StallError(`no data for ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer))
}

const streamToBlocks = async (response: Response, callbacks: ParseCallbacks): Promise<Block[]> => {
  if (!response.body) {
    throw new Error("No response body")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let state = initialParseState()
  let firstBytesLogged = false

  try {
    while (true) {
      const { done, value } = await readWithTimeout(reader, STALL_TIMEOUT_MS)
      if (done) break

      if (!firstBytesLogged) {
        console.log("[LLM] First bytes received", performance.now().toFixed(0) + "ms")
        firstBytesLogged = true
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        state = processLine(line, state, callbacks)
        callbacks.onStateSnapshot?.(stateToBlocks(state))
      }
    }

    if (buffer.trim()) {
      state = processLine(buffer, state, callbacks)
      callbacks.onStateSnapshot?.(stateToBlocks(state))
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }

  const blocks = stateToBlocks(state)
  for (const block of blocks) {
    callbacks.onBlock?.(block)
  }
  callbacks.onStreamEnd?.()

  console.debug("[STREAM END]", {
    pendingToolCalls: state.pendingToolCalls.length,
    blocks: blocks.length,
  })

  return blocks
}

interface CallLlmOptions {
  endpoint: string
  messages: InputItem[]
  tools?: ToolDefinition[]
  blockSchemas?: BlockSchemaDefinition[]
  databaseSchema?: string
  responseFormat?: ResponseFormat
  temperature?: number
  callbacks?: ParseCallbacks
  signal?: AbortSignal
}

const formatBlockSchema = (s: BlockSchemaDefinition): string => {
  const traits = [s.singleton ? "singleton" : "multiple"]
  if (s.immutable.length > 0) traits.push(`immutable: ${s.immutable.join(", ")}`)
  const header = `### ${s.language} (${traits.join("; ")})`
  const schema = JSON.stringify(s.jsonSchema, null, 2)
  const constraints =
    s.constraints.length > 0
      ? `\nConstraints:\n${s.constraints.map((c) => `- ${c}`).join("\n")}`
      : ""
  return `${header}\n${schema}${constraints}`
}

export const formatBlockSchemasContent = (schemas: BlockSchemaDefinition[]): string =>
  `Document block schemas:\n\n${schemas.map(formatBlockSchema).join("\n\n")}`

export const formatDatabaseSchemaContent = (schema: string): string =>
  `Database schema (DuckDB):\n\n${schema}`

const buildRequestBody = (options: CallLlmOptions): string => {
  const extras: InputItem[] = []
  if (options.blockSchemas?.length)
    extras.push(toSystem(formatBlockSchemasContent(options.blockSchemas)))
  if (options.databaseSchema)
    extras.push(toSystem(formatDatabaseSchemaContent(options.databaseSchema)))
  const messages = extras.length > 0 ? [...extras, ...options.messages] : options.messages
  const body: Record<string, unknown> = { messages }
  if (options.tools) body.tools = options.tools
  if (options.responseFormat) body.response_format = options.responseFormat
  return JSON.stringify(body)
}

const buildUrl = (endpoint: string, temperature?: number): string => {
  const base = `${getLlmHost()}${endpoint}`
  if (temperature === undefined) return base
  const sep = endpoint.includes("?") ? "&" : "?"
  return `${base}${sep}temperature=${temperature}`
}

const summarizeBlocks = (blocks: Block[]): Record<string, number> =>
  blocks.reduce<Record<string, number>>(
    (acc, b) => ({ ...acc, [b.type]: (acc[b.type] ?? 0) + 1 }),
    {}
  )

const previewText = (blocks: Block[]): string | undefined => {
  const text = blocks.find((b) => b.type === "text")
  return text?.type === "text" ? text.content : undefined
}

const LLM_CACHE_PREFIX = "llm"
const LLM_CACHE_CAP = 10_000
const UNCACHEABLE_ENDPOINTS = ["/qual-coder", "/semantic-filter"]

const isCacheable = (options: CallLlmOptions): boolean =>
  !options.callbacks &&
  options.temperature === undefined &&
  !UNCACHEABLE_ENDPOINTS.some((p) => options.endpoint.includes(p))

const hasErrorBlock = (blocks: Block[]): boolean => blocks.some((b) => b.type === "error")

const withStreamSnapshot = (callbacks: ParseCallbacks, rawId: number): ParseCallbacks => ({
  ...callbacks,
  onStateSnapshot: (blocks: Block[]) => {
    callbacks.onStateSnapshot?.(blocks)
    updateRawCallStream(rawId, JSON.stringify(blocks))
  },
})

const executeLlmCall = async (
  options: CallLlmOptions,
  body: string,
  rawId: number
): Promise<Block[]> => {
  const response = await fetchWithRetry({
    url: buildUrl(options.endpoint, options.temperature),
    body,
    signal: options.signal,
  })
  const callbacks = withStreamSnapshot(options.callbacks ?? {}, rawId)
  return streamToBlocks(response, callbacks)
}

export const callLlm = async (options: CallLlmOptions): Promise<Block[]> => {
  const body = buildRequestBody(options)
  const cacheable = isCacheable(options)
  const cacheKey = cacheable ? buildKey([options.endpoint, body]) : undefined

  if (cacheKey) {
    const cached = await tryGet<Block[]>(LLM_CACHE_PREFIX, cacheKey)
    if (cached) {
      console.debug(`[LLM ${options.endpoint}] cache hit`)
      return cached
    }
  }

  const rawId = startRawCall(options.endpoint, body)
  const t0 = performance.now()
  let blocks!: Block[]

  for (let attempt = 0; attempt <= MAX_FILTER_RETRIES; attempt++) {
    try {
      blocks = await executeLlmCall(options, body, rawId)
    } catch (err) {
      if (!isStallError(err) || attempt === MAX_FILTER_RETRIES) throw err
      console.warn(`[LLM ${options.endpoint}] stall detected, retry ${attempt + 1}`)
      continue
    }

    const retryable = findRetryableError(blocks)
    if (!retryable || attempt === MAX_FILTER_RETRIES) break
    console.warn(
      `[LLM ${options.endpoint}] content filter (${retryable.errorType}), retry ${attempt + 1}`
    )
  }

  const duration = Math.round(performance.now() - t0)
  completeRawCall(rawId, JSON.stringify(blocks), duration)
  console.debug(`[LLM ${options.endpoint}]`, {
    blocks: summarizeBlocks(blocks),
    preview: previewText(blocks),
  })

  if (cacheKey && !hasErrorBlock(blocks)) {
    tryPut(LLM_CACHE_PREFIX, cacheKey, blocks, LLM_CACHE_CAP, options.endpoint)
  }

  return blocks
}
