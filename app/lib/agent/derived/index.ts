import type { Block, ToolCall, ToolCallBlock } from "../client/blocks"
import type { FileStore } from "~/lib/files/store"
import {
  type DerivedPlan,
  isPlanMarker,
  parsePlanBlock,
  processCompleteStep,
  updateLastPlan,
  hasActivePlan,
} from "./plan"

export interface Derived {
  plans: DerivedPlan[]
}

type Mode = "chat" | "plan" | "exec"

type EnrichedToolCall = ToolCall & { succeeded: boolean }
interface EnrichedToolCallBlock {
  type: "tool_call"
  calls: EnrichedToolCall[]
}
type EnrichedBlock = Exclude<Block, ToolCallBlock> | EnrichedToolCallBlock

export const isToolCallBlock = (block: Block): block is { type: "tool_call"; calls: ToolCall[] } =>
  block.type === "tool_call"

export const isDebugPauseBlock = (block: Block): boolean => block.type === "debug_pause"

export const isErrorResult = (result: unknown): boolean =>
  typeof result === "object" &&
  result !== null &&
  "status" in result &&
  ((result as { status: string }).status === "error" ||
    (result as { status: string }).status === "partial")

const isEnrichedToolCallBlock = (block: EnrichedBlock): block is EnrichedToolCallBlock =>
  block.type === "tool_call"

const collectResultStatuses = (history: Block[]): Map<string, string> => {
  const statuses = new Map<string, string>()
  for (const block of history) {
    if (block.type === "tool_result") {
      const status = (block.result as { status?: string })?.status ?? "ok"
      statuses.set(block.callId, status)
    }
  }
  return statuses
}

const enrichWithResults = (history: Block[]): EnrichedBlock[] => {
  const statuses = collectResultStatuses(history)
  return history.map((block): EnrichedBlock => {
    if (block.type !== "tool_call") return block
    return {
      ...block,
      calls: block.calls.map((call) => ({
        ...call,
        succeeded: statuses.get(call.id) === "ok",
      })),
    }
  })
}

export const findCall = (block: Block, name: string): ToolCall | undefined =>
  isToolCallBlock(block) ? block.calls.find((c) => c.name === name) : undefined

const hasCall = (block: Block, name: string): boolean => findCall(block, name) !== undefined

const isCompleteStep = (call: EnrichedToolCall): boolean => call.name === "complete_step"
const isCancel = (call: EnrichedToolCall): boolean => call.name === "cancel"

const processToolCall = (derived: Derived, call: EnrichedToolCall): Derived => {
  if (!call.succeeded) return derived

  if (isCancel(call)) {
    return {
      plans: updateLastPlan(derived.plans, (p) => ({ ...p, aborted: true })),
    }
  }

  if (isCompleteStep(call)) {
    const lastPlan = derived.plans.at(-1)
    if (!lastPlan || lastPlan.currentStep === null) return derived
    const internal = (call.args.internal as string) || null
    return {
      ...derived,
      plans: updateLastPlan(derived.plans, (p) => processCompleteStep(p, internal)),
    }
  }

  return derived
}

const processBlock = (derived: Derived, block: EnrichedBlock): Derived => {
  if (block.type === "system") {
    const plan = parsePlanBlock(block.content)
    if (plan) return { ...derived, plans: [...derived.plans, plan] }
    return derived
  }
  if (!isEnrichedToolCallBlock(block)) return derived
  return block.calls.reduce((d, call) => processToolCall(d, call), derived)
}

export const derive = (history: Block[], _files: FileStore = {}): Derived =>
  enrichWithResults(history).reduce(processBlock, { plans: [] })

export const getMode = (d: Derived): Mode => {
  if (hasActivePlan(d.plans)) return "exec"
  return "chat"
}

const isBlockPlanMarker = (block: Block): boolean =>
  block.type === "system" && isPlanMarker(block.content)

const isStepBoundary = (block: Block): boolean =>
  hasCall(block, "submit_plan") || hasCall(block, "complete_step") || isBlockPlanMarker(block)

const isAgentAction = (block: Block): boolean => block.type === "text" || block.type === "tool_call"

const countActionsSinceBoundary = (history: Block[], isBoundary: (b: Block) => boolean): number => {
  let count = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const block = history[i]
    if (isBoundary(block)) break
    if (isAgentAction(block)) count++
  }
  return count
}

export const isPlanPaused = (history: Block[]): boolean => {
  let foundText = false
  for (let i = history.length - 1; i >= 0; i--) {
    const block = history[i]
    if (isStepBoundary(block)) return foundText
    if (block.type === "text") foundText = true
  }
  return false
}

export const actionsSinceStepChange = (history: Block[]): number =>
  countActionsSinceBoundary(history, isStepBoundary)

export const findLastUserContent = (blocks: Block[]): string => {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === "user") return (blocks[i] as { type: "user"; content: string }).content
  }
  return ""
}

export {
  type DerivedPlan,
  type Step,
  type StepDef,
  type StepDefObject,
  serializePlanBlock,
  lastPlan,
  hasActivePlan,
  guardCompleteStep,
  isLastStep,
} from "./plan"
