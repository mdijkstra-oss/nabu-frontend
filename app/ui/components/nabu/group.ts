import type { Block } from "~/lib/agent/client/blocks"
import { type Derived, type DerivedPlan, type Step } from "~/lib/agent/derived"
import {
  type TextMessage,
  type AskMessage,
  type Indexed,
  textMessagesIndexed,
  extractAskMessages,
  findPlanBlockIndices,
  byIndex,
} from "./messages"

export type LeafMessage = TextMessage

export type StepStatus = "completed" | "active" | "pending" | "cancelled"

export interface PlanStep {
  type: "plan-step"
  description: string
  status: StepStatus
  nested: boolean
  checkpoint: boolean
}

export type PlanChild = PlanStep | LeafMessage

export interface PlanHeader {
  type: "plan-header"
  task: string
  completed: boolean
  aborted: boolean
}

export interface PlanItem {
  type: "plan-item"
  child: PlanChild
  dimmed: boolean
}

export type GroupedMessage = LeafMessage | AskMessage | PlanHeader | PlanItem

interface PlanRange {
  plan: DerivedPlan
  startIndex: number
  endIndex: number
}

interface FlatEntry {
  blockIndex: number
  item: PlanHeader | PlanItem
}

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

const isSuccessfulCompleteStep = (block: Block, statuses: Map<string, string>): boolean => {
  if (block.type !== "tool_call") return false
  return block.calls.some((call) => call.name === "complete_step" && statuses.get(call.id) === "ok")
}

const isTerminatingResult = (block: Block, plan: DerivedPlan): boolean => {
  if (block.type !== "tool_result") return false
  if (plan.aborted) return block.toolName === "cancel"
  if (isPlanCompleted(plan)) return block.toolName === "complete_step"
  return false
}

const findTerminationIndex = (
  history: Block[],
  plan: DerivedPlan,
  start: number,
  bound: number
): number => {
  if (!plan.aborted && !isPlanCompleted(plan)) return bound
  for (let i = bound - 1; i >= start; i--) {
    if (isTerminatingResult(history[i], plan)) return i + 1
  }
  return bound
}

const buildPlanRanges = (history: Block[], plans: DerivedPlan[]): PlanRange[] => {
  const indices = findPlanBlockIndices(history)
  return plans.map((plan, i) => {
    const startIndex = indices[i] ?? 0
    const rawEnd = indices[i + 1] ?? history.length
    return { plan, startIndex, endIndex: findTerminationIndex(history, plan, startIndex, rawEnd) }
  })
}

const isPlanCompleted = (plan: DerivedPlan): boolean => plan.currentStep === null && !plan.aborted

const getStepStatus = (
  step: Step,
  flatIndex: number,
  currentStep: number | null,
  aborted: boolean
): StepStatus => {
  if (step.done) return "completed"
  if (aborted && currentStep === flatIndex) return "cancelled"
  if (currentStep === flatIndex) return "active"
  return "pending"
}

interface StepTransition {
  blockIndex: number
  newStep: number
}

const findStepTransitions = (
  history: Block[],
  planStart: number,
  planEnd: number
): StepTransition[] => {
  const statuses = collectResultStatuses(history)
  const transitions: StepTransition[] = []
  let currentStep = 0

  for (let i = planStart; i < planEnd; i++) {
    if (!isSuccessfulCompleteStep(history[i], statuses)) continue
    currentStep++
    transitions.push({ blockIndex: i + 1, newStep: currentStep })
  }

  return transitions
}

const toItem = (child: PlanChild, dimmed: boolean): PlanItem => ({
  type: "plan-item",
  child,
  dimmed,
})

const buildPlanHeader = (plan: DerivedPlan): PlanHeader => ({
  type: "plan-header",
  task: plan.task,
  completed: isPlanCompleted(plan),
  aborted: plan.aborted,
})

const buildPlanEntries = (
  range: PlanRange,
  leaves: Indexed<LeafMessage>[],
  history: Block[]
): FlatEntry[] => {
  const { plan, startIndex, endIndex } = range
  const transitions = findStepTransitions(history, startIndex, endIndex)
  const totalSteps = plan.steps.length

  const header: FlatEntry = {
    blockIndex: startIndex,
    item: buildPlanHeader(plan),
  }

  const makeStepEntry = (step: Step, i: number, blockIndex: number): FlatEntry => ({
    blockIndex,
    item: toItem(
      {
        type: "plan-step" as const,
        description: step.description,
        status: getStepStatus(step, i, plan.currentStep, plan.aborted),
        nested: step.id.includes("."),
        checkpoint: step.checkpoint,
      },
      false
    ),
  })

  const stepActivations: FlatEntry[] = plan.steps.flatMap((step, i) => {
    const startPosition =
      i === 0
        ? startIndex
        : (transitions.find((t) => t.newStep === i)?.blockIndex ??
          endIndex - (totalSteps - i) * 0.001)

    return [makeStepEntry(step, i, startPosition)]
  })

  const visibleLeaves = leaves

  const leafEntries: FlatEntry[] = visibleLeaves.map((l) => ({
    blockIndex: l.index,
    item: toItem(l.message, false),
  }))

  return [header, ...stepActivations, ...leafEntries]
}

const isInRange = (index: number, range: PlanRange): boolean =>
  index >= range.startIndex && index < range.endIndex

const isConsumedLeaf = (leaf: Indexed<LeafMessage>, consumed: Set<number>): boolean =>
  leaf.message.role === "user" && consumed.has(leaf.index)

export interface KeyedMessage {
  key: string
  message: GroupedMessage
}

export const toGroupedMessages = (history: Block[], derived: Derived): KeyedMessage[] => {
  const planRanges = buildPlanRanges(history, derived.plans)
  const { messages: askMessages, consumedUserIndices } = extractAskMessages(history)

  const allLeaves: Indexed<LeafMessage>[] = textMessagesIndexed(history)
    .filter((l) => !isConsumedLeaf(l, consumedUserIndices))
    .sort(byIndex)

  const planLeaves = new Map<number, Indexed<LeafMessage>[]>()
  const outsideLeaves: Indexed<LeafMessage>[] = []

  for (const leaf of allLeaves) {
    const rangeIdx = planRanges.findIndex((r) => isInRange(leaf.index, r))
    if (rangeIdx === -1) {
      outsideLeaves.push(leaf)
    } else {
      const existing = planLeaves.get(rangeIdx) ?? []
      existing.push(leaf)
      planLeaves.set(rangeIdx, existing)
    }
  }

  interface KeyedEntry {
    sortIndex: number
    key: string
    item: GroupedMessage
  }

  const outsideKeyed: KeyedEntry[] = outsideLeaves.map((l, i) => ({
    sortIndex: l.index,
    key: `msg-${i}`,
    item: l.message,
  }))

  const askKeyed: KeyedEntry[] = askMessages.map((a) => ({
    sortIndex: a.index,
    key: `ask-${a.index}`,
    item: a.message,
  }))

  const planKeyed: KeyedEntry[] = planRanges.flatMap((range, planIdx) =>
    buildPlanEntries(range, planLeaves.get(planIdx) ?? [], history).map((e, entryIdx) => ({
      sortIndex: e.blockIndex,
      key: `plan-${planIdx}-${entryIdx}`,
      item: e.item,
    }))
  )

  return [...outsideKeyed, ...askKeyed, ...planKeyed]
    .sort((a, b) => a.sortIndex - b.sortIndex)
    .map((e) => ({ key: e.key, message: e.item }))
}
