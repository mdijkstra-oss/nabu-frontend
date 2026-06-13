import type { Block, ToolCall } from "~/lib/agent/client/blocks"
import type { FileStore } from "~/lib/files/store"
import { derive, findCall, type DerivedPlan } from "~/lib/agent/derived"
import { isPlanMarker } from "~/lib/agent/derived/plan"
import { AskArgs, type AskOption } from "~/lib/agent/tools/ask/def"

export interface TextMessage {
  type: "text"
  role: "user" | "assistant"
  content: string
  draft?: true
  timestamp?: number
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

// Sometimes refine_code returns no actionable findings and no `ask` follows —
// suppressing assistant chat until an `ask` that never arrives breaks the flow.
const SUPPRESSION_RULES: readonly SuppressionRule[] = [
  // { afterResult: "refine_code", untilCall: "ask" },
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
        ...(history[index].timestamp !== undefined && { timestamp: history[index].timestamp }),
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
  timestamp?: number
  answerTimestamp?: number
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
  const questionTimestamp = history[index].timestamp
  const answerTimestamp = userIndices.length > 0 ? history[userIndices[0]].timestamp : undefined

  return [
    {
      index,
      message: {
        type: "ask" as const,
        question: args.question,
        options: args.options,
        selected,
        ...(questionTimestamp !== undefined && { timestamp: questionTimestamp }),
        ...(answerTimestamp !== undefined && { answerTimestamp }),
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

export { isWaitingForAsk } from "~/lib/agent/client/status"
