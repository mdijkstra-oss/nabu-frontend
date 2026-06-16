import type { Block } from "~/lib/agent/client/blocks"
import type { HistoryEntry, HistoryActor } from "~/lib/mutation-history/types"
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

export interface PlanStartMessage {
  type: "plan-start"
  task: string
  completed: boolean
  aborted: boolean
  timestamp?: number
}

export interface PlanStepMessage {
  type: "plan-step"
  description: string
  status: StepStatus
  checkpoint: boolean
  nested: boolean
  timestamp?: number
}

export interface EditGroupMessage {
  type: "edit-group"
  actor: HistoryActor
  entries: HistoryEntry[]
  timestamp: number
}

export type GroupedMessage =
  | LeafMessage
  | AskMessage
  | PlanStartMessage
  | PlanStepMessage
  | EditGroupMessage

interface PlanRange {
  plan: DerivedPlan
  startIndex: number
  endIndex: number
}

interface FlatEntry {
  blockIndex: number
  item: PlanStartMessage | PlanStepMessage
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

const buildPlanStart = (plan: DerivedPlan, history: Block[], startIndex: number): FlatEntry => ({
  blockIndex: startIndex,
  item: {
    type: "plan-start",
    task: plan.task,
    completed: isPlanCompleted(plan),
    aborted: plan.aborted,
    ...(history[startIndex]?.timestamp !== undefined && {
      timestamp: history[startIndex].timestamp,
    }),
  },
})

const findStepStart = (
  i: number,
  transitions: StepTransition[],
  startIndex: number,
  endIndex: number,
  totalSteps: number
): number => {
  if (i === 0) return startIndex
  const transition = transitions.find((t) => t.newStep === i)
  return transition?.blockIndex ?? endIndex - (totalSteps - i) * 0.001
}

const findStepTimestamp = (
  i: number,
  transitions: StepTransition[],
  history: Block[],
  startIndex: number
): number | undefined => {
  if (i === 0) return history[startIndex]?.timestamp
  const transition = transitions.find((t) => t.newStep === i)
  if (transition === undefined) return undefined
  return history[transition.blockIndex - 1]?.timestamp
}

const buildStepEntry = (
  step: Step,
  i: number,
  plan: DerivedPlan,
  history: Block[],
  transitions: StepTransition[],
  startIndex: number,
  endIndex: number,
  totalSteps: number
): FlatEntry => {
  const blockIndex = findStepStart(i, transitions, startIndex, endIndex, totalSteps)
  const timestamp = findStepTimestamp(i, transitions, history, startIndex)
  return {
    blockIndex,
    item: {
      type: "plan-step",
      description: step.description,
      status: getStepStatus(step, i, plan.currentStep, plan.aborted),
      checkpoint: step.checkpoint,
      nested: step.id.includes("."),
      ...(timestamp !== undefined && { timestamp }),
    },
  }
}

const buildPlanEntries = (range: PlanRange, history: Block[]): FlatEntry[] => {
  const { plan, startIndex, endIndex } = range
  const transitions = findStepTransitions(history, startIndex, endIndex)
  const totalSteps = plan.steps.length

  const planStart = buildPlanStart(plan, history, startIndex)
  const stepEntries = plan.steps.map((step, i) =>
    buildStepEntry(step, i, plan, history, transitions, startIndex, endIndex, totalSteps)
  )

  return [planStart, ...stepEntries]
}

export interface KeyedMessage {
  key: string
  message: GroupedMessage
}

interface KeyedEntry {
  sortIndex: number
  key: string
  item: GroupedMessage
}

const isResetTrigger = (m: GroupedMessage): boolean => {
  if (m.type === "ask") return true
  if (m.type === "plan-start") return true
  if (m.type === "plan-step") return true
  if (m.type === "text" && m.role === "user") return true
  return false
}

const isAssistantLeaf = (m: GroupedMessage): m is TextMessage =>
  m.type === "text" && m.role === "assistant"

const stampAnswerRun = (entries: KeyedEntry[]): KeyedEntry[] => {
  let prevReset = true
  return entries.map((e) => {
    const m = e.item
    if (isAssistantLeaf(m)) {
      const stamped: TextMessage = { ...m, firstInAnswerRun: prevReset }
      prevReset = false
      return { ...e, item: stamped }
    }
    if (isResetTrigger(m)) prevReset = true
    return e
  })
}

const isConsumedLeaf = (leaf: Indexed<LeafMessage>, consumed: Set<number>): boolean =>
  leaf.message.role === "user" && consumed.has(leaf.index)

const isIndexInPlan = (index: number, ranges: PlanRange[]): boolean =>
  ranges.some((r) => index >= r.startIndex && index < r.endIndex)

const markInPlan = (leaf: Indexed<LeafMessage>, ranges: PlanRange[]): Indexed<LeafMessage> =>
  isIndexInPlan(leaf.index, ranges) ? { ...leaf, message: { ...leaf.message, inPlan: true } } : leaf

export const toGroupedMessages = (history: Block[], derived: Derived): KeyedMessage[] => {
  const planRanges = buildPlanRanges(history, derived.plans)
  const { messages: askMessages, consumedUserIndices } = extractAskMessages(history)

  const allLeaves: Indexed<LeafMessage>[] = textMessagesIndexed(history)
    .filter((l) => !isConsumedLeaf(l, consumedUserIndices))
    .map((l) => markInPlan(l, planRanges))
    .sort(byIndex)

  const leafKeyed: KeyedEntry[] = allLeaves.map((l, i) => ({
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
    buildPlanEntries(range, history).map((e, entryIdx) => ({
      sortIndex: e.blockIndex,
      key: `plan-${planIdx}-${entryIdx}`,
      item: e.item,
    }))
  )

  const merged = [...leafKeyed, ...askKeyed, ...planKeyed].sort((a, b) => a.sortIndex - b.sortIndex)

  return stampAnswerRun(merged).map((e) => ({ key: e.key, message: e.item }))
}

const editGroupKey = (entries: HistoryEntry[]): string => {
  const first = entries[0]
  return `edit-${first.timestamp}-${first.actor}-${first.path}-${entries.length}`
}

const toEditGroup = (entries: HistoryEntry[]): KeyedMessage => ({
  key: editGroupKey(entries),
  message: {
    type: "edit-group",
    actor: entries[0].actor,
    entries,
    timestamp: entries[0].timestamp,
  },
})

const effectiveTimestamps = (messages: KeyedMessage[]): number[] => {
  let last = 0
  return messages.map(({ message }) => {
    last = message.timestamp ?? last
    return last
  })
}

export const weaveEditGroups = (
  messages: KeyedMessage[],
  entries: HistoryEntry[]
): KeyedMessage[] => {
  if (entries.length === 0) return messages
  const edits = [...entries].sort((a, b) => a.timestamp - b.timestamp)
  const timestamps = effectiveTimestamps(messages)
  const out: KeyedMessage[] = []
  let buffer: HistoryEntry[] = []
  let editIndex = 0

  const flush = (): void => {
    if (buffer.length === 0) return
    out.push(toEditGroup(buffer))
    buffer = []
  }

  const absorb = (entry: HistoryEntry): void => {
    if (buffer.length > 0 && buffer[0].actor !== entry.actor) flush()
    buffer.push(entry)
  }

  const drainUntil = (limit: number): void => {
    while (editIndex < edits.length && edits[editIndex].timestamp <= limit) {
      absorb(edits[editIndex])
      editIndex++
    }
  }

  const isPendingStepMessage = (m: GroupedMessage): boolean =>
    m.type === "plan-step" && m.status === "pending"

  messages.forEach((km, i) => {
    if (isPendingStepMessage(km.message)) drainUntil(Infinity)
    else drainUntil(timestamps[i])
    flush()
    out.push(km)
  })

  drainUntil(Infinity)
  flush()
  return out
}
