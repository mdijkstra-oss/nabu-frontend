import type { Block, ToolCall } from "~/lib/agent/client/blocks"
import type { FileStore } from "~/lib/files/store"
import { derive, findCall, type DerivedPlan } from "~/lib/agent/derived"
import { isPlanMarker } from "~/lib/agent/derived/plan"
import { AskArgs, type AskOption } from "~/lib/agent/tools/ask/def"
import { ScoutArgs } from "~/lib/agent/tools/scout/def"
import { PlanDeepAnalysisArgs } from "~/lib/agent/tools/plan-deep-analysis/def"

export interface TextMessage {
  type: "text"
  role: "user" | "assistant"
  content: string
  draft?: true
}

export interface PlanMessage {
  type: "plan"
  plan: DerivedPlan
  currentStep: number | null
  aborted: boolean
}

export type RenderMessage = TextMessage | PlanMessage

export interface Indexed<T> {
  index: number
  message: T
}

const hasContent = (s: string): boolean => s.trim().length > 0

const NOISE_PATTERNS = ["malformed function call"] as const

const isLlmNoise = (content: string): boolean =>
  NOISE_PATTERNS.some((p) => content.toLowerCase().includes(p))

const isContentBlock = (b: Block): b is { type: "user" | "text" | "error"; content: string } =>
  b.type === "user" || b.type === "text" || b.type === "error"

const hasDraft = (b: Block): boolean => "draft" in b && b.draft === true

interface SuppressionRule {
  afterResult: string
  untilCall: string
}

const SUPPRESSION_RULES: readonly SuppressionRule[] = [
  { afterResult: "refine_code", untilCall: "ask" },
]

const isResultOf = (block: Block, toolName: string): boolean =>
  block.type === "tool_result" && block.toolName === toolName

const findMatchingRule = (block: Block): SuppressionRule | null => {
  for (const rule of SUPPRESSION_RULES) {
    if (isResultOf(block, rule.afterResult)) return rule
  }
  return null
}

const isResumeBlock = (block: Block, rule: SuppressionRule): boolean =>
  findCall(block, rule.untilCall) !== undefined

const findSuppressedIndices = (history: Block[]): Set<number> => {
  const suppressed = new Set<number>()
  let activeRule: SuppressionRule | null = null
  for (let i = 0; i < history.length; i++) {
    const block = history[i]
    if (activeRule && isResumeBlock(block, activeRule)) {
      activeRule = null
      continue
    }
    if (!activeRule) {
      const match = findMatchingRule(block)
      if (match) activeRule = match
      continue
    }
    suppressed.add(i)
  }
  return suppressed
}

export const textMessagesIndexed = (history: Block[]): Indexed<TextMessage>[] => {
  const suppressed = findSuppressedIndices(history)
  return history
    .map((b, i) => ({ block: b, index: i }))
    .filter(
      (
        item
      ): item is { block: { type: "user" | "text" | "error"; content: string }; index: number } =>
        isContentBlock(item.block) &&
        hasContent(item.block.content) &&
        !isLlmNoise(item.block.content)
    )
    .filter(({ block, index }) => block.type === "user" || !suppressed.has(index))
    .map(({ block, index }) => ({
      index,
      message: {
        type: "text" as const,
        role: block.type === "user" ? "user" : "assistant",
        content: block.content,
        ...(hasDraft(history[index]) && { draft: true as const }),
      },
    }))
}

export const findPlanBlockIndices = (history: Block[]): number[] =>
  history
    .map((b, i) => ({ block: b, index: i }))
    .filter(({ block }) => block.type === "system" && isPlanMarker(block.content))
    .map(({ index }) => index)

const planMessagesIndexed = (history: Block[], plans: DerivedPlan[]): Indexed<PlanMessage>[] => {
  const indices = findPlanBlockIndices(history)
  return plans.map((plan, i) => ({
    index: indices[i] ?? 0,
    message: { type: "plan", plan, currentStep: plan.currentStep, aborted: plan.aborted },
  }))
}

export const byIndex = <T>(a: Indexed<T>, b: Indexed<T>): number => a.index - b.index

export const toRenderMessages = (history: Block[], files: FileStore = {}): RenderMessage[] => {
  const d = derive(history, files)
  const indexed: Indexed<RenderMessage>[] = [
    ...textMessagesIndexed(history),
    ...planMessagesIndexed(history, d.plans),
  ]
  return indexed.sort(byIndex).map((item) => item.message)
}

export type { AskOption }

export interface AskMessage {
  type: "ask"
  question: string
  options: AskOption[]
  selected: string | null
}

interface AskExtraction {
  messages: Indexed<AskMessage>[]
  consumedUserIndices: Set<number>
}

const findAskCalls = (history: Block[]): { index: number; call: ToolCall }[] =>
  history.flatMap((block, index) => {
    const call = findCall(block, "ask")
    return call ? [{ index, call }] : []
  })

const findConsumedUserIndices = (history: Block[], askIndex: number, callId: string): number[] => {
  const indices: number[] = []
  for (let i = askIndex + 1; i < history.length; i++) {
    const block = history[i]
    if (block.type === "tool_result" && block.callId === callId) break
    if (block.type === "user") indices.push(i)
  }
  return indices
}

interface ParsedAskArgs {
  question: string
  options: AskOption[]
}

const parseAskArgs = (args: Record<string, unknown>): ParsedAskArgs | null => {
  const parsed = AskArgs.safeParse(args)
  if (!parsed.success) return null
  return {
    question: parsed.data.question,
    options: parsed.data.options,
  }
}

const extractSingleAsk = (
  index: number,
  call: ToolCall,
  history: Block[],
  consumed: Set<number>
): Indexed<AskMessage>[] => {
  const args = parseAskArgs(call.args)
  if (!args) return []

  const userIndices = findConsumedUserIndices(history, index, call.id)
  userIndices.forEach((i) => consumed.add(i))

  const userAnswer =
    userIndices.length > 0 ? (history[userIndices[0]] as { content: string }).content : null
  const selected = userAnswer

  return [
    {
      index,
      message: {
        type: "ask" as const,
        question: args.question,
        options: args.options,
        selected,
      },
    },
  ]
}

export const extractAskMessages = (history: Block[]): AskExtraction => {
  const consumed = new Set<number>()
  const messages = findAskCalls(history).flatMap(({ index, call }) =>
    extractSingleAsk(index, call, history, consumed)
  )
  return { messages, consumedUserIndices: consumed }
}

export type ScoutFileState = "pending" | "done" | "failed"

export interface ScoutFileStatus {
  path: string
  group: string
  status: ScoutFileState
}

export interface ScoutMessage {
  type: "scout"
  files: ScoutFileStatus[]
}

const SCOUT_TOOL_NAMES = ["scout", "plan_deep_analysis"] as const

const findScoutLikeCalls = (history: Block[]): { index: number; call: ToolCall }[] =>
  history.flatMap((block, index) =>
    SCOUT_TOOL_NAMES.flatMap((name) => {
      const call = findCall(block, name)
      return call ? [{ index, call }] : []
    })
  )

const findScoutResultIndex = (history: Block[], callId: string): number | null => {
  for (let i = 0; i < history.length; i++) {
    if (history[i].type === "tool_result" && (history[i] as { callId: string }).callId === callId)
      return i
  }
  return null
}

const collectDoneFiles = (history: Block[], from: number, to: number): Set<string> => {
  const done = new Set<string>()
  for (let i = from; i < to; i++) {
    const block = history[i]
    if (block.type !== "system") continue
    const match = block.content.match(/^File: (.+?)(?:\n|$)/)
    if (match) done.add(match[1])
  }
  return done
}

const deriveFileState = (
  path: string,
  doneFiles: Set<string>,
  toolFinished: boolean
): ScoutFileState => {
  if (doneFiles.has(path)) return "done"
  if (toolFinished) return "failed"
  return "pending"
}

interface ParsedScoutFiles {
  files: ScoutFileStatus[]
}

const parseScoutCallFiles = (
  call: ToolCall,
  doneFiles: Set<string>,
  toolFinished: boolean
): ParsedScoutFiles | null => {
  const scoutParsed = ScoutArgs.safeParse(call.args)
  if (scoutParsed.success) {
    return {
      files: scoutParsed.data.files.map((f) => ({
        path: f.path,
        group: f.group,
        status: deriveFileState(f.path, doneFiles, toolFinished),
      })),
    }
  }

  const deepParsed = PlanDeepAnalysisArgs.safeParse(call.args)
  if (deepParsed.success) {
    const sourceEntries = deepParsed.data.source_files.map((f) => ({
      path: f.path,
      group: f.group,
      status: deriveFileState(f.path, doneFiles, toolFinished),
    }))
    const targetEntries = deepParsed.data.target_files
      .filter((f): f is { path: string; group: string } => "path" in f)
      .map((f) => ({
        path: f.path,
        group: f.group,
        status: deriveFileState(f.path, doneFiles, toolFinished),
      }))
    return { files: [...sourceEntries, ...targetEntries] }
  }

  return null
}

const extractSingleScout = (
  index: number,
  call: ToolCall,
  history: Block[]
): Indexed<ScoutMessage>[] => {
  const resultIndex = findScoutResultIndex(history, call.id)
  const toolFinished = resultIndex !== null
  const scanEnd = resultIndex ?? history.length
  const doneFiles = collectDoneFiles(history, index + 1, scanEnd)

  const parsed = parseScoutCallFiles(call, doneFiles, toolFinished)
  if (!parsed) return []

  return [{ index, message: { type: "scout" as const, files: parsed.files } }]
}

export const extractScoutMessages = (history: Block[]): Indexed<ScoutMessage>[] =>
  findScoutLikeCalls(history).flatMap(({ index, call }) => extractSingleScout(index, call, history))

export { isWaitingForAsk } from "~/lib/agent/client/status"
