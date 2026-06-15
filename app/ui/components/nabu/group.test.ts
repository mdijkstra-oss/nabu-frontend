import { describe, expect, it, beforeEach } from "vitest"
import type { Block } from "~/lib/agent/client/blocks"
import { derive } from "~/lib/agent/derived"
import {
  toGroupedMessages,
  weaveEditGroups,
  type GroupedMessage,
  type KeyedMessage,
  type PlanStartMessage,
  type PlanStepMessage,
  type LeafMessage,
  type EditGroupMessage,
} from "./group"
import type { HistoryEntry, HistoryActor } from "~/lib/mutation-history/types"
import {
  submitPlanCall,
  completeStepCall,
  cancelCall,
  resetCallIdCounter,
  userBlock,
  textBlock,
} from "~/lib/agent/test-helpers"

function mustFind<T, S extends T>(arr: T[], pred: (item: T) => item is S): S
function mustFind<T>(arr: T[], pred: (item: T) => boolean): T
function mustFind<T>(arr: T[], pred: (item: T) => boolean): T {
  const found = arr.find(pred)
  if (!found) throw new Error("expected item not found")
  return found
}

beforeEach(() => resetCallIdCounter())

const group = (history: Block[], files = {}): GroupedMessage[] =>
  toGroupedMessages(history, derive(history, files)).map((k) => k.message)

const isPlanStart = (m: GroupedMessage): m is PlanStartMessage => m.type === "plan-start"
const isPlanStep = (m: GroupedMessage): m is PlanStepMessage => m.type === "plan-step"
const isAssistantLeaf = (m: GroupedMessage): m is LeafMessage =>
  m.type === "text" && m.role === "assistant"

const planSteps = (result: GroupedMessage[]): PlanStepMessage[] => result.filter(isPlanStep)

describe("toGroupedMessages", () => {
  describe("no plan", () => {
    const cases = [
      {
        name: "empty history returns empty",
        history: [] as Block[],
        check: (result: GroupedMessage[]) => {
          expect(result).toEqual([])
        },
      },
      {
        name: "flat text messages pass through as leaves",
        history: [userBlock("Hello"), textBlock("Hi there")],
        check: (result: GroupedMessage[]) => {
          expect(result).toHaveLength(2)
          expect(result[0]).toMatchObject({ type: "text", role: "user", content: "Hello" })
          expect(result[1]).toMatchObject({
            type: "text",
            role: "assistant",
            content: "Hi there",
            firstInAnswerRun: true,
          })
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(group(history)))
  })

  describe("simple plan", () => {
    const cases = [
      {
        name: "plan-start and plan-step interleave with leaves",
        history: [
          userBlock("Help me"),
          ...submitPlanCall("Build feature", ["Design", "Implement"]),
          textBlock("Starting design"),
          ...completeStepCall(),
          textBlock("Now implementing"),
        ],
        check: (result: GroupedMessage[]) => {
          expect(result[0].type).toBe("text")
          const start = mustFind(result, isPlanStart)
          expect(start.task).toBe("Build feature")
          expect(start.completed).toBe(false)
          expect(start.aborted).toBe(false)
          const steps = planSteps(result)
          expect(steps).toHaveLength(2)
          expect(steps[0].status).toBe("completed")
          expect(steps[1].status).toBe("active")
          const leaves = result.filter(isAssistantLeaf)
          expect(leaves.map((l) => l.content)).toEqual(["Starting design", "Now implementing"])
        },
      },
      {
        name: "completed plan has completed flag and all steps completed",
        history: [...submitPlanCall("Task", ["Step 1"]), ...completeStepCall()],
        check: (result: GroupedMessage[]) => {
          const start = mustFind(result, isPlanStart)
          expect(start.completed).toBe(true)
          expect(start.aborted).toBe(false)
          const steps = planSteps(result)
          expect(steps[0].status).toBe("completed")
        },
      },
      {
        name: "cancelled plan has aborted flag and cancelled step",
        history: [...submitPlanCall("Task", ["Step 1", "Step 2"]), ...cancelCall()],
        check: (result: GroupedMessage[]) => {
          const start = mustFind(result, isPlanStart)
          expect(start.aborted).toBe(true)
          expect(start.completed).toBe(false)
          const steps = planSteps(result)
          expect(steps[0].status).toBe("cancelled")
          expect(steps[1].status).toBe("pending")
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(group(history)))
  })

  describe("nested steps", () => {
    const cases = [
      {
        name: "nested steps are flattened as plan-step messages with nested=true",
        history: [
          ...submitPlanCall("Process", [
            { title: "Setup", expected: "Setup done" },
            { nested: ["Analyze", "Code"] },
            { title: "Wrap up", expected: "Wrapped up" },
          ]),
        ],
        check: (result: GroupedMessage[]) => {
          const steps = planSteps(result)
          expect(steps).toHaveLength(4)
          expect(steps.map((s) => s.description)).toEqual(["Setup", "Analyze", "Code", "Wrap up"])
          expect(steps.map((s) => s.nested)).toEqual([false, true, true, false])
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(group(history)))
  })

  describe("messages around plan", () => {
    const cases = [
      {
        name: "assistant text before plan is a top-level leaf",
        history: [
          userBlock("Before plan"),
          textBlock("Response before"),
          ...submitPlanCall("Task", ["Step 1"]),
          textBlock("Inside plan"),
        ],
        check: (result: GroupedMessage[]) => {
          expect(result[0]).toMatchObject({ type: "text", role: "user" })
          expect(result[1]).toMatchObject({ type: "text", role: "assistant" })
          expect(result[2].type).toBe("plan-start")
          const leaves = result.filter(isAssistantLeaf)
          expect(leaves).toHaveLength(2)
        },
      },
      {
        name: "messages after completed plan are flat leaves",
        history: [
          ...submitPlanCall("Task", ["Step 1"]),
          textBlock("Inside plan"),
          ...completeStepCall(),
          userBlock("After completion"),
          textBlock("Back to chat"),
        ],
        check: (result: GroupedMessage[]) => {
          const leaves = result.filter((m) => m.type === "text") as LeafMessage[]
          expect(leaves).toHaveLength(3)
          expect(leaves.map((l) => l.content)).toEqual([
            "Inside plan",
            "After completion",
            "Back to chat",
          ])
        },
      },
      {
        name: "two plans both emit plan-start cards",
        history: [
          ...submitPlanCall("First", ["Step 1"]),
          ...completeStepCall(),
          textBlock("Between plans"),
          ...submitPlanCall("Second", ["Step 2"]),
        ],
        check: (result: GroupedMessage[]) => {
          const starts = result.filter(isPlanStart)
          expect(starts).toHaveLength(2)
          expect(starts[0].task).toBe("First")
          expect(starts[1].task).toBe("Second")
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(group(history)))
  })

  describe("firstInAnswerRun stamping", () => {
    const flagsOf = (result: GroupedMessage[]): (boolean | undefined)[] =>
      result.filter(isAssistantLeaf).map((l) => l.firstInAnswerRun)

    const cases = [
      {
        name: "single assistant after user is first-in-run",
        history: [userBlock("Q"), textBlock("A")],
        expected: [true],
      },
      {
        name: "consecutive assistants after one user — first true, rest false",
        history: [userBlock("Q"), textBlock("A1"), textBlock("A2"), textBlock("A3")],
        expected: [true, false, false],
      },
      {
        name: "user between assistants resets run",
        history: [userBlock("Q1"), textBlock("A1"), userBlock("Q2"), textBlock("A2")],
        expected: [true, true],
      },
      {
        name: "plan-start between assistants resets run",
        history: [
          userBlock("Q"),
          textBlock("A1"),
          ...submitPlanCall("Task", ["Step"]),
          textBlock("A2"),
        ],
        expected: [true, true],
      },
      {
        name: "plan-step between assistants resets run",
        history: [
          ...submitPlanCall("Task", ["Step 1", "Step 2"]),
          textBlock("A1"),
          ...completeStepCall(),
          textBlock("A2"),
        ],
        expected: [true, true],
      },
      {
        name: "first assistant on empty history is still first-in-run",
        history: [textBlock("A")],
        expected: [true],
      },
    ]

    it.each(cases)("$name", ({ history, expected }) => {
      expect(flagsOf(group(history))).toEqual(expected)
    })
  })
})

const keyedText = (ts: number, content = "msg"): KeyedMessage => ({
  key: `m-${ts}`,
  message: { type: "text", role: "assistant", content, timestamp: ts },
})

const histEntry = (
  ts: number,
  actor: HistoryActor,
  overrides: Partial<HistoryEntry> = {}
): HistoryEntry => ({
  verb: "added",
  entityKind: "annotation",
  entityId: null,
  path: "a.md",
  timestamp: ts,
  actor,
  label: "x",
  ...overrides,
})

const editGroupsOf = (result: KeyedMessage[]): EditGroupMessage[] =>
  result.map((k) => k.message).filter((m): m is EditGroupMessage => m.type === "edit-group")

const typesOf = (result: KeyedMessage[]): string[] => result.map((k) => k.message.type)

describe("weaveEditGroups", () => {
  it("returns messages unchanged when there are no entries", () => {
    const messages = [keyedText(10), keyedText(20)]
    expect(weaveEditGroups(messages, [])).toBe(messages)
  })

  const cases = [
    {
      name: "single edit between two messages becomes a group in between",
      messages: [keyedText(10), keyedText(30)],
      entries: [histEntry(20, "ai")],
      check: (out: KeyedMessage[]) => {
        expect(typesOf(out)).toEqual(["text", "edit-group", "text"])
        expect(editGroupsOf(out)[0].entries).toHaveLength(1)
      },
    },
    {
      name: "consecutive same-actor edits collapse into one group",
      messages: [keyedText(10), keyedText(50)],
      entries: [histEntry(20, "ai"), histEntry(30, "ai"), histEntry(40, "ai")],
      check: (out: KeyedMessage[]) => {
        const groups = editGroupsOf(out)
        expect(groups).toHaveLength(1)
        expect(groups[0].entries).toHaveLength(3)
        expect(groups[0].actor).toBe("ai")
      },
    },
    {
      name: "actor change splits into two adjacent groups in order",
      messages: [keyedText(10), keyedText(50)],
      entries: [histEntry(20, "ai"), histEntry(30, "user")],
      check: (out: KeyedMessage[]) => {
        const groups = editGroupsOf(out)
        expect(groups.map((g) => g.actor)).toEqual(["ai", "user"])
        expect(groups.map((g) => g.entries.length)).toEqual([1, 1])
      },
    },
    {
      name: "trailing edits after the last message appear at the end",
      messages: [keyedText(10)],
      entries: [histEntry(20, "user"), histEntry(30, "user")],
      check: (out: KeyedMessage[]) => {
        expect(typesOf(out)).toEqual(["text", "edit-group"])
        expect(editGroupsOf(out)[0].entries).toHaveLength(2)
      },
    },
    {
      name: "edit before the first message appears at the start",
      messages: [keyedText(10)],
      entries: [histEntry(5, "ai")],
      check: (out: KeyedMessage[]) => {
        expect(typesOf(out)).toEqual(["edit-group", "text"])
      },
    },
  ]

  it.each(cases)("$name", ({ messages, entries, check }) =>
    check(weaveEditGroups(messages, entries))
  )
})
