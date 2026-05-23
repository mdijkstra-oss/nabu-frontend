import type { z } from "zod"
import type { Block, ToolCall, ToolResultBlock } from "./blocks"
import type { ParseCallbacks } from "./parse"
import type { ResponseFormat } from "./convert"
import { callLlm } from "./fetch"
import { blocksToMessages } from "./convert"
import { pushBlocks } from "./store"
import { executeTool, canceledToolResult, trimErrorOutput, type ToolExecutor } from "../turn"
import { formatZodError, type ToolDefinition } from "../executors/tool"
import type { BlockSchemaDefinition } from "~/lib/data-blocks/json-schema"
import { isToolCallBlock } from "../derived"
import { yieldToBrowser } from "~/lib/utils/async"
import { setPendingRefsSuppressed, resolvePendingRefsInBulk } from "~/lib/files/store"

interface CallerConfig {
  endpoint: string
  tools?: ToolDefinition[]
  toolSchemas?: Record<string, z.ZodType>
  blockSchemas?: BlockSchemaDefinition[]
  databaseSchema?: string
  execute?: ToolExecutor
  responseFormat?: ResponseFormat
  callbacks?: ParseCallbacks
  readBlocks: () => Block[]
  transformBlocks?: (blocks: Block[]) => Block[]
  source?: string
}

type Caller = (signal?: AbortSignal) => Promise<Block[]>

const executeToolCalls = async (
  calls: ToolCall[],
  execute: ToolExecutor,
  signal?: AbortSignal
): Promise<ToolResultBlock[]> => {
  setPendingRefsSuppressed(true)
  try {
    const results: ToolResultBlock[] = []
    for (let i = 0; i < calls.length; i++) {
      if (signal?.aborted) {
        for (let j = i; j < calls.length; j++) results.push(canceledToolResult(calls[j]))
        break
      }
      results.push(await executeTool(calls[i], execute))
      await yieldToBrowser()
    }
    return results
  } finally {
    setPendingRefsSuppressed(false)
    resolvePendingRefsInBulk()
  }
}

const stripNullArgs = (args: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null))

const validateCallArgs = (call: ToolCall, schemas: Record<string, z.ZodType>): string | null => {
  const schema = schemas[call.name]
  if (!schema) return null
  const parsed = schema.safeParse(stripNullArgs(call.args))
  return parsed.success ? null : formatZodError(parsed.error)
}

const toValidationError = (call: ToolCall, message: string): ToolResultBlock => ({
  type: "tool_result",
  callId: call.id,
  toolName: call.name,
  result: { status: "error", output: trimErrorOutput(`Invalid arguments: ${message}`) },
})

interface PartitionedCalls {
  valid: ToolCall[]
  errors: ToolResultBlock[]
}

const cleanCall = (call: ToolCall): ToolCall => ({ ...call, args: stripNullArgs(call.args) })

const partitionCalls = (
  calls: ToolCall[],
  schemas: Record<string, z.ZodType>
): PartitionedCalls => {
  const cleaned = calls.map(cleanCall)
  const tagged = cleaned.map((call) => ({ call, error: validateCallArgs(call, schemas) }))
  return {
    valid: tagged.filter((t) => t.error === null).map((t) => t.call),
    errors: tagged
      .filter((t): t is { call: ToolCall; error: string } => t.error !== null)
      .map(({ call, error }) => toValidationError(call, error)),
  }
}

interface ValidatedBlocks {
  committed: Block[]
  validCalls: ToolCall[]
}

const validateAndInterleave = (
  blocks: Block[],
  schemas: Record<string, z.ZodType>
): ValidatedBlocks => {
  const partitions = blocks.map((block) =>
    isToolCallBlock(block)
      ? { block, ...partitionCalls(block.calls, schemas) }
      : { block, valid: [] as ToolCall[], errors: [] as ToolResultBlock[] }
  )
  return {
    committed: partitions.flatMap(({ block, errors }) => [block, ...errors]),
    validCalls: partitions.flatMap(({ valid }) => valid),
  }
}

export const buildCaller =
  (config: CallerConfig): Caller =>
  async (signal) => {
    const history = config.readBlocks()
    const raw = await callLlm({
      endpoint: config.endpoint,
      messages: blocksToMessages(history),
      tools: config.tools,
      blockSchemas: config.blockSchemas,
      databaseSchema: config.databaseSchema,
      responseFormat: config.responseFormat,
      callbacks: config.callbacks,
      signal,
    })

    const blocks = config.transformBlocks ? config.transformBlocks(raw) : raw
    const schemas = config.toolSchemas ?? {}
    const source = config.source ?? "base"
    const { committed, validCalls } = validateAndInterleave(blocks, schemas)
    pushBlocks(committed, source)

    const validationErrors = committed.filter((b): b is ToolResultBlock => b.type === "tool_result")

    if (validCalls.length > 0 && config.execute) {
      const results = await executeToolCalls(validCalls, config.execute, signal)
      pushBlocks(results, source)
      return [...blocks, ...validationErrors, ...results]
    }

    return [...blocks, ...validationErrors]
  }
