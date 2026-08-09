import type { HistoryEntry } from "~/lib/mutation-history/types"
import type {
  LeafMessage,
  PlanStartMessage,
  PlanStepMessage,
  EditGroupMessage,
  StepStatus,
} from "./group"
import type { AskMessage } from "./messages"
import type { FinalSegment, KeyedSegment, StepStackSegment } from "./collapse"

export const EPOCH = 1717000000000

export const CHAT_SIDEBAR_WIDTH = "380px"

export const userLeaf: LeafMessage = {
  type: "text",
  role: "user",
  content: "How do the interviews describe onboarding?",
  timestamp: EPOCH,
}

export const assistantLeaf: LeafMessage = {
  type: "text",
  role: "assistant",
  content: "Onboarding is described as **rushed** in most interviews.",
  timestamp: EPOCH + 60_000,
}

export const draftLeaf: LeafMessage = {
  type: "text",
  role: "assistant",
  content: "Here is what I found so far\n```js\nconst partial",
  draft: true,
  timestamp: EPOCH + 120_000,
}

export const draftLeafEmpty: LeafMessage = {
  type: "text",
  role: "assistant",
  content: "```js\nconst partial",
  draft: true,
  timestamp: EPOCH + 120_000,
}

export const unansweredAsk: AskMessage = {
  type: "ask",
  question: "Which section should I analyze first?",
  options: [
    { label: "The onboarding chapter", expected: "onboarding" },
    { label: "The exit interviews", expected: "exit" },
  ],
  selected: null,
  timestamp: EPOCH + 180_000,
}

export const answeredAsk: AskMessage = {
  type: "ask",
  question: "Which section should I analyze first?",
  options: [
    { label: "The onboarding chapter", expected: "onboarding" },
    { label: "The exit interviews", expected: "exit" },
  ],
  selected: "The onboarding chapter",
  timestamp: EPOCH + 180_000,
  answerTimestamp: EPOCH + 240_000,
}

export const typedAnswerAsk: AskMessage = {
  type: "ask",
  question: "Which section should I analyze first?",
  options: [
    { label: "The onboarding chapter", expected: "onboarding" },
    { label: "The exit interviews", expected: "exit" },
  ],
  selected: "Start with the recruitment notes instead",
  timestamp: EPOCH + 180_000,
  answerTimestamp: EPOCH + 240_000,
}

export const planStart: PlanStartMessage = {
  type: "plan-start",
  task: "Analyze onboarding themes across all interviews",
  completed: false,
  aborted: false,
  timestamp: EPOCH + 300_000,
}

const stepStatuses: StepStatus[] = ["completed", "active", "pending", "cancelled"]

export const planStepMatrix: PlanStepMessage[] = stepStatuses.flatMap((status) =>
  [false, true].flatMap((checkpoint) =>
    [false, true].map((nested) => ({
      type: "plan-step" as const,
      description: [status, checkpoint && "checkpoint", nested && "nested"]
        .filter(Boolean)
        .join(" "),
      status,
      checkpoint,
      nested,
      timestamp: EPOCH + 360_000,
    }))
  )
)

const editEntry = (overrides: Partial<HistoryEntry>): HistoryEntry => ({
  verb: "updated",
  entityKind: "annotation",
  entityId: "annotation-1",
  path: "interviews.md",
  timestamp: EPOCH + 420_000,
  actor: "ai",
  label: "Onboarding felt rushed",
  ...overrides,
})

export const editGroupSingle: EditGroupMessage = {
  type: "edit-group",
  actor: "ai",
  entries: [editEntry({})],
  timestamp: EPOCH + 420_000,
}

export const editGroupMulti: EditGroupMessage = {
  type: "edit-group",
  actor: "ai",
  entries: [
    editEntry({ entityId: "annotation-1", label: "Onboarding felt rushed" }),
    editEntry({
      verb: "added",
      entityId: "annotation-2",
      path: "exit_notes.md",
      label: "Exit reasons cluster on pay",
      timestamp: EPOCH + 421_000,
    }),
    editEntry({
      verb: "removed",
      entityKind: "tag",
      entityId: "tag-1",
      path: "settings.md",
      label: "Stale tag",
      timestamp: EPOCH + 422_000,
    }),
  ],
  timestamp: EPOCH + 420_000,
}

export const stepStackFive: StepStackSegment = {
  type: "step-stack",
  steps: [
    {
      type: "plan-step",
      description: "Collect interview excerpts",
      status: "pending",
      checkpoint: false,
      nested: false,
    },
    {
      type: "plan-step",
      description: "Code recurring themes",
      status: "pending",
      checkpoint: false,
      nested: false,
    },
    {
      type: "plan-step",
      description: "Tag onboarding mentions",
      status: "pending",
      checkpoint: false,
      nested: true,
    },
    {
      type: "plan-step",
      description: "Tag exit mentions",
      status: "pending",
      checkpoint: false,
      nested: true,
    },
    {
      type: "plan-step",
      description: "Draft the summary",
      status: "pending",
      checkpoint: false,
      nested: false,
    },
  ],
}

const keyed = (prefix: string, segments: FinalSegment[]): KeyedSegment[] =>
  segments.map((segment, i) => ({ key: `${prefix}-${i}`, segment }))

export const segmentFixtures: Record<FinalSegment["type"], KeyedSegment[]> = {
  text: keyed("text", [userLeaf, assistantLeaf, draftLeaf]),
  ask: keyed("ask", [unansweredAsk, answeredAsk, typedAnswerAsk]),
  "plan-start": keyed("plan-start", [planStart]),
  "plan-step": keyed("plan-step", planStepMatrix),
  "edit-group": keyed("edit-group", [editGroupSingle, editGroupMulti]),
  "step-stack": keyed("step-stack", [stepStackFive]),
  "continue-prompt": keyed("continue-prompt", [{ type: "continue-prompt" }]),
}
