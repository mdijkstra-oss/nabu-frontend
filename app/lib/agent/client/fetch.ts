import type { Block, ErrorBlock } from "./blocks"
import type { ToolDefinition } from "../executors/tool"
import type { BlockSchemaDefinition } from "~/lib/data-blocks/json-schema"
import { getLlmHost, getLlmHeaders } from "~/lib/agent/env"
import { getActiveSignal } from "~/lib/utils/signal"
import { initialParseState, processLine, stateToBlocks, type ParseCallbacks } from "./parse"
import { toSystem } from "./convert"
import type { InputItem, ResponseFormat } from "./convert"
import { startRawCall, completeRawCall, updateRawCallStream } from "./raw-store"
import { buildKey, tryGet, tryPut } from "~/lib/utils/storage-cache"

const MAX_FILTER_RETRIES = 2

const RETRYABLE_ERROR_TYPES = new Set(["SAFETY", "RECITATION", "content_filter"])

const findRetryableError = (blocks: Block[]): ErrorBlock | undefined =>
  blocks.find(
    (b): b is ErrorBlock => b.type === "error" && RETRYABLE_ERROR_TYPES.has(b.errorType ?? "")
  )

interface FetchOptions {
  url: string
  body: string
  signal?: AbortSignal
}

const isSignal = (s: AbortSignal | null | undefined): s is AbortSignal => s != null

const combineSignals = (...signals: (AbortSignal | null | undefined)[]): AbortSignal =>
  AbortSignal.any(signals.filter(isSignal))

const fetchOnce = async ({ url, body, signal }: FetchOptions): Promise<Response> => {
  const response = await fetch(url, {
    method: "POST",
    headers: getLlmHeaders(),
    body,
    signal: combineSignals(signal, getActiveSignal()),
  })
  if (!response.ok) throw new Error(`LLM request failed: ${response.status}`)
  return response
}

const streamToBlocks = async (response: Response, callbacks: ParseCallbacks): Promise<Block[]> => {
  if (!response.body) {
    throw new Error("No response body")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let state = initialParseState()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

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
  const response = await fetchOnce({
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
    if (cached) return cached
  }

  const rawId = startRawCall(options.endpoint, body)
  const t0 = performance.now()
  let blocks!: Block[]

  for (let attempt = 0; attempt <= MAX_FILTER_RETRIES; attempt++) {
    blocks = await executeLlmCall(options, body, rawId)
    const retryable = findRetryableError(blocks)
    if (!retryable || attempt === MAX_FILTER_RETRIES) break
    console.warn(
      `[LLM ${options.endpoint}] content filter (${retryable.errorType}), retry ${attempt + 1}`
    )
  }

  const duration = Math.round(performance.now() - t0)
  completeRawCall(rawId, JSON.stringify(blocks), duration)

  if (cacheKey && !hasErrorBlock(blocks)) {
    tryPut(LLM_CACHE_PREFIX, cacheKey, blocks, LLM_CACHE_CAP, options.endpoint)
  }

  return blocks
}
