import { z } from "zod"
import type { Block } from "./client/blocks"
import type { Handler } from "./types"
import { getToolHandlers } from "./executors/tool"
import { createExecutor } from "./executors/execute"
import { blockPatchTools } from "./tools/block-tools/register"
import { applyLocalPatch } from "./tools/apply-local-patch/def"
import { runLocalShell } from "./tools/run-local-shell/def"
import { filterBySource, getAllBlocks, pushBlocks } from "./client/store"
import { runAgentLoop } from "./agent-loop"
import { compactHistory, hasCompactedBlock } from "./compact"
import { baselineNudge } from "./steering/nudges/baseline"
import { getFiles } from "~/lib/files/store"
import { CHARS_PER_TOKEN } from "~/lib/text/constants"

const DONE_TOOL = "done"

const WRITE_ANSWER_ENDPOINT = "/write-answer?chat=true"
const MAX_TURNS = 10
const TOKEN_BUDGET = 10_000

const doneDef = {
  name: DONE_TOOL,
  description: "Signal that all updates are complete.",
  schema: z.object({
    result: z
      .string()
      .describe("Summary of what was written and where, or note that no changes were needed."),
  }),
}

const TOOLS = [...blockPatchTools, applyLocalPatch, runLocalShell, doneDef]

const doneHandler: Handler = async (_files, args) => ({
  status: "ok",
  output: (args.result as string) ?? "",
  mutations: [],
})

const hasDoneResult = (blocks: Block[]): boolean =>
  blocks.some((b) => b.type === "tool_result" && b.toolName === DONE_TOOL)

const findDoneResult = (blocks: Block[]): string => {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b.type !== "tool_call") continue
    const doneCall = b.calls.find((c) => c.name === DONE_TOOL)
    if (doneCall) return (doneCall.args.result as string) ?? ""
  }
  return ""
}

const estimateBlockChars = (b: Block): number => {
  if ("content" in b) return (b as { content: string }).content.length
  if (b.type === "tool_call") return JSON.stringify(b.calls).length
  if (b.type === "tool_result") return JSON.stringify(b.result).length
  return 0
}

const isSafeBudgetBoundary = (b: Block): boolean => b.type !== "tool_result"

const takeWithinBudget = (blocks: Block[], tokenBudget: number): Block[] => {
  const charBudget = tokenBudget * CHARS_PER_TOKEN
  let used = 0
  let start = blocks.length
  for (let i = blocks.length - 1; i >= 0; i--) {
    used += estimateBlockChars(blocks[i])
    start = i
    if (used >= charBudget && isSafeBudgetBoundary(blocks[i])) break
  }
  return blocks.slice(start)
}

const isNotSystemBlock = (b: Block): boolean => b.type !== "system"

const resolvedCallIds = (blocks: Block[]): Set<string> => {
  const ids = new Set<string>()
  for (const b of blocks) if (b.type === "tool_result") ids.add(b.callId)
  return ids
}

const dropUnresolvedTail = (blocks: Block[]): Block[] => {
  const resolved = resolvedCallIds(blocks)
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b.type !== "tool_call") continue
    return b.calls.every((c) => resolved.has(c.id)) ? blocks : blocks.slice(0, i)
  }
  return blocks
}

const sumChars = (blocks: Block[]): number =>
  blocks.reduce((sum, b) => sum + estimateBlockChars(b), 0)

const formatTokens = (chars: number): string => {
  const tokens = Math.round(chars / CHARS_PER_TOKEN)
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

const DEBUG_PREFIX = "[debug]"

const isDebugMarker = (b: Block): boolean =>
  b.type === "system" && b.content.startsWith(DEBUG_PREFIX)

const formatDebugMarker = (includedChars: number): Block => ({
  type: "system",
  content: `${DEBUG_PREFIX} ~${formatTokens(includedChars)} of ${formatTokens(TOKEN_BUDGET * CHARS_PER_TOKEN)} tokens`,
})

const getChatHistory = (): { history: Block[]; debugMarker: Block } => {
  const base = filterBySource(getAllBlocks(), "base")
  const compacted = compactHistory(base, getFiles())
  const hasCompaction = hasCompactedBlock(base)
  const summary = hasCompaction ? [compacted[0]] : []
  const rest = dropUnresolvedTail(
    (hasCompaction ? compacted.slice(1) : compacted).filter(isNotSystemBlock)
  )
  const budgeted = takeWithinBudget(rest, TOKEN_BUDGET)
  const history = [...summary, ...budgeted]
  return { history, debugMarker: formatDebugMarker(sumChars(budgeted)) }
}

let counter = 0
const nextSource = (): string => `branch:${++counter}`

const prependHistory =
  (history: Block[]) =>
  (blocks: Block[]): Block[] => [...history, ...blocks.filter((b) => !isDebugMarker(b))]

export const agentWithChatHistory = async (instruction: string): Promise<string> => {
  const source = nextSource()
  const { history, debugMarker } = getChatHistory()

  pushBlocks([debugMarker, { type: "system", content: instruction }], source)

  const handlers = { ...getToolHandlers(), [DONE_TOOL]: doneHandler }

  await runAgentLoop({
    source,
    executor: createExecutor(handlers),
    maxTurns: MAX_TURNS,
    shouldContinue: (blocks) => !hasDoneResult(blocks),
    resolve: () => ({
      endpoint: WRITE_ANSWER_ENDPOINT,
      tools: TOOLS,
      toolChoice: "required",
      nudges: [baselineNudge],
      processBlocks: prependHistory(history),
    }),
  })

  return findDoneResult(filterBySource(getAllBlocks(), source))
}
