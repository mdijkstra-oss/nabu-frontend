import type { Block } from "./client/blocks"
import type { ParseCallbacks } from "./client/parse"
import type { ToolExecutor } from "./turn"
import type { AnyTool } from "./executors/tool"
import type { Nudger } from "./steering/nudge-tools"
import type { BlockSchemaDefinition } from "~/lib/data-blocks/json-schema"
import { toToolDefinition, toSchemaMap } from "./executors/tool"
import { buildCaller } from "./client/caller"
import { pushBlocks, getAllBlocks, isDraft, subscribeBlocks, filterBySource } from "./client/store"
import { isErrorResult, isDebugPauseBlock } from "./derived"
import { collect, isEmptyNudgeBlock } from "./steering/nudge-tools"
import { getBlockSchemaDefinitions } from "~/lib/data-blocks/registry"
import { getDatabaseSchema } from "~/domain/db/database"
import { extractEntityIdCandidates } from "~/lib/markdown/linkify/extract"
import { modes, deriveMode } from "./executors/modes"
import { getFiles } from "~/lib/files/store"
import { resolveEntityName } from "~/lib/files/selectors"
import { readDebugOption } from "./debug"

interface AgentLoopConfig {
  executor: ToolExecutor
  callbacks?: ParseCallbacks
  signal?: AbortSignal
}

interface IterationConfig {
  endpoint: string
  tools: AnyTool[]
  nudges: Nudger[]
  transformResponse?: (blocks: Block[]) => Block[]
  blockSchemas?: BlockSchemaDefinition[]
  databaseSchema?: string
}

interface AgentRunConfig {
  source: string
  executor: ToolExecutor
  callbacks?: ParseCallbacks
  signal?: AbortSignal
  maxTurns?: number
  shouldContinue?: (newBlocks: Block[]) => boolean
  resolve: (blocks: Block[]) => IterationConfig
  afterTurn?: (newBlocks: Block[]) => Promise<void>
}

export const excludeReasoning = (blocks: Block[]): Block[] =>
  blocks.filter((b) => b.type !== "reasoning")

export const hasToolCalls = (blocks: Block[]): boolean => blocks.some((b) => b.type === "tool_call")

export const shouldContinue = (newBlocks: Block[]): boolean => hasToolCalls(newBlocks)

export const runAgentLoop = async (config: AgentRunConfig): Promise<void> => {
  const { source, executor, callbacks, signal, maxTurns = 50 } = config

  for (let turn = 0; turn < maxTurns; turn++) {
    const sourceBlocks = filterBySource(getAllBlocks(), source)
    const iter = config.resolve(sourceBlocks)
    const tools = iter.tools.map(toToolDefinition)
    const nudge = collect(...iter.nudges)

    const nudgeBlocks = await nudge(excludeReasoning(sourceBlocks))
    if (nudgeBlocks.length === 0) return

    const nonEmpty = nudgeBlocks.filter((b) => !isEmptyNudgeBlock(b))
    if (nonEmpty.length > 0) pushBlocks(nonEmpty, source)

    const caller = buildCaller({
      endpoint: iter.endpoint,
      tools,
      toolSchemas: toSchemaMap(iter.tools),
      blockSchemas: iter.blockSchemas,
      databaseSchema: iter.databaseSchema,
      execute: executor,
      callbacks,
      source,
      readBlocks: () => filterBySource(getAllBlocks(), source),
      transformBlocks: iter.transformResponse,
    })

    const newBlocks = await caller(signal)
    if (config.afterTurn) await config.afterTurn(newBlocks)
    const continueCheck = config.shouldContinue ?? shouldContinue
    if (!continueCheck(newBlocks)) return
  }
}

const shouldPauseOnError = (blocks: Block[]): boolean =>
  hasToolError(blocks) && readDebugOption("showStreamPanel", false)

const hasToolError = (blocks: Block[]): boolean =>
  blocks.some((b) => b.type === "tool_result" && isErrorResult(b.result))

const hasPauseBlock = (): boolean => getAllBlocks().some(isDebugPauseBlock)

const awaitResume = (signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const tryResolve = () => {
      if (!hasPauseBlock()) {
        cleanup()
        resolve()
      }
    }
    const unsub = subscribeBlocks(tryResolve)
    const onAbort = () => {
      cleanup()
      resolve()
    }
    const cleanup = () => {
      unsub()
      signal?.removeEventListener("abort", onAbort)
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    tryResolve()
  })

const findDanglingIds = (text: string): string[] => {
  const candidates = extractEntityIdCandidates(text)
  if (candidates.length === 0) return []
  const files = getFiles()
  return candidates.filter((id) => resolveEntityName(files, id) === null)
}

const REJECTION_PREFIX = "Your response was rejected."

const rejectDanglingBlock = (block: Block): Block => {
  if (block.type !== "text" || isDraft(block)) return block
  const dangling = findDanglingIds(block.content)
  if (dangling.length === 0) return block
  return {
    type: "system",
    content: `${REJECTION_PREFIX} Your last message was rejected because these entity IDs do not exist: ${dangling.join(", ")}\nIn your next message DO NOT restate any of these identifiers. Continue without them.`,
  }
}

export const isRejectionBlock = (block: Block): boolean =>
  block.type === "system" && block.content.startsWith(REJECTION_PREFIX)

export const hasRejection = (blocks: Block[]): boolean => blocks.some(isRejectionBlock)

// Error blocks render in chat but are never sent back to the model, so the
// note flags the answer for the user without polluting the transcript.
const flagDanglingBlock = (block: Block): Block[] => {
  if (block.type !== "text" || isDraft(block)) return [block]
  const dangling = findDanglingIds(block.content)
  if (dangling.length === 0) return [block]
  return [
    block,
    {
      type: "error",
      content: `This answer references entities that do not exist: ${dangling.join(", ")}. It could not be corrected — judge it accordingly.`,
    },
  ]
}

const MAX_REJECTIONS = 3

interface RejectionState {
  consecutive: number
}

// After MAX_REJECTIONS consecutive rejections the answer is let through,
// flagged for the user, instead of being swallowed as a hidden rejection.
const buildDanglingIdTransform =
  (state: RejectionState) =>
  (blocks: Block[]): Block[] => {
    if (hasToolCalls(blocks)) return blocks
    if (state.consecutive >= MAX_REJECTIONS) return blocks.flatMap(flagDanglingBlock)
    return blocks.map(rejectDanglingBlock)
  }

const buildRejectionGuard =
  (state: RejectionState) =>
  (newBlocks: Block[]): boolean => {
    if (shouldContinue(newBlocks)) {
      state.consecutive = 0
      return true
    }
    if (hasRejection(newBlocks) && state.consecutive < MAX_REJECTIONS) {
      state.consecutive++
      return true
    }
    state.consecutive = 0
    return false
  }

export const agentLoop = async (config: AgentLoopConfig): Promise<void> => {
  const rejections: RejectionState = { consecutive: 0 }
  const transformResponse = buildDanglingIdTransform(rejections)
  return runAgentLoop({
    source: "base",
    executor: config.executor,
    callbacks: config.callbacks,
    signal: config.signal,
    shouldContinue: buildRejectionGuard(rejections),
    resolve: (blocks) => {
      const mode = deriveMode(blocks)
      const modeConfig = modes[mode]
      return {
        endpoint: modeConfig.endpoint,
        tools: modeConfig.tools,
        nudges: modeConfig.nudges,
        transformResponse,
        blockSchemas: getBlockSchemaDefinitions(),
        databaseSchema: getDatabaseSchema(),
      }
    },
    afterTurn: async (newBlocks) => {
      if (shouldPauseOnError(newBlocks)) {
        pushBlocks([{ type: "debug_pause" }], "base")
        await awaitResume(config.signal)
      }
    },
  })
}
