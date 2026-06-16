import type {
  GroupedMessage,
  KeyedMessage,
  LeafMessage,
  PlanStartMessage,
  PlanStepMessage,
  EditGroupMessage,
} from "./group"
import type { AskMessage } from "./messages"

export interface StepStackSegment {
  type: "step-stack"
  steps: PlanStepMessage[]
}

export interface ContinuePromptSegment {
  type: "continue-prompt"
}

export type FinalSegment = GroupedMessage | StepStackSegment | ContinuePromptSegment

export interface KeyedSegment {
  key: string
  segment: FinalSegment
}

export const COLLAPSE_THRESHOLD = 4

export const isAskSegment = (s: FinalSegment): s is AskMessage => s.type === "ask"

export const isPlanStartSegment = (s: FinalSegment): s is PlanStartMessage =>
  s.type === "plan-start"

export const isPlanStepSegment = (s: FinalSegment): s is PlanStepMessage => s.type === "plan-step"

export const isStepStackSegment = (s: FinalSegment): s is StepStackSegment =>
  s.type === "step-stack"

export const isContinuePromptSegment = (s: FinalSegment): s is ContinuePromptSegment =>
  s.type === "continue-prompt"

export const isLeafSegment = (s: FinalSegment): s is LeafMessage => s.type === "text"

export const isEditGroupSegment = (s: FinalSegment): s is EditGroupMessage =>
  s.type === "edit-group"

export const toKeyedSegments = (entries: KeyedMessage[]): KeyedSegment[] =>
  entries.map(({ key, message }) => ({ key, segment: message }))

const isActiveCheckpointStep = (s: FinalSegment): boolean =>
  isPlanStepSegment(s) && s.status === "active" && s.checkpoint

const isPendingStep = (s: FinalSegment): boolean => isPlanStepSegment(s) && s.status === "pending"

const findActiveCheckpointIndex = (segments: KeyedSegment[]): number =>
  segments.findIndex((s) => isActiveCheckpointStep(s.segment))

const findStepBoundaryAfter = (segments: KeyedSegment[], start: number): number => {
  for (let i = start; i < segments.length; i++) {
    const t = segments[i].segment.type
    if (t === "plan-step" || t === "plan-start") return i
  }
  return segments.length
}

export const injectContinuePrompt = (
  segments: KeyedSegment[],
  waiting: boolean
): KeyedSegment[] => {
  if (!waiting) return segments
  const checkpointIdx = findActiveCheckpointIndex(segments)
  if (checkpointIdx === -1) return segments
  const insertAt = findStepBoundaryAfter(segments, checkpointIdx + 1)
  const prompt: KeyedSegment = { key: "continue-prompt", segment: { type: "continue-prompt" } }
  return [...segments.slice(0, insertAt), prompt, ...segments.slice(insertAt)]
}

export const collapsePendingTail = (segments: KeyedSegment[]): KeyedSegment[] => {
  const pending = segments
    .filter((s) => isPendingStep(s.segment))
    .map((s) => s.segment as PlanStepMessage)
  if (pending.length <= COLLAPSE_THRESHOLD) return segments

  const stack: KeyedSegment = {
    key: "step-stack",
    segment: { type: "step-stack", steps: pending },
  }
  const out: KeyedSegment[] = []
  let inserted = false
  segments.forEach((s) => {
    if (isPendingStep(s.segment)) {
      if (!inserted) {
        out.push(stack)
        inserted = true
      }
      return
    }
    out.push(s)
  })
  return out
}
