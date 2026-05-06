import { describe, expect, it, beforeEach } from "vitest"
import type { Block } from "~/lib/agent/client/blocks"
import { derive } from "~/lib/agent/derived"
import {
  toGroupedMessages,
  type GroupedMessage,
  type PlanHeader,
  type PlanItem,
  type PlanStep,
} from "./group"
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
  toGroupedMessages(history, derive(history, files))

const isPlanHeader = (m: GroupedMessage): m is PlanHeader => m.type === "plan-header"
const isPlanItem = (m: GroupedMessage): m is PlanItem => m.type === "plan-item"
const isPlanStepItem = (m: GroupedMessage): m is PlanItem =>
  m.type === "plan-item" && m.child.type === "plan-step"
const planSteps = (result: GroupedMessage[]): PlanStep[] =>
  result.filter(isPlanStepItem).map((m) => m.child as PlanStep)

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
          expect(result[0]).toEqual({ type: "text", role: "user", content: "Hello" })
          expect(result[1]).toEqual({ type: "text", role: "assistant", content: "Hi there" })
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(group(history)))
  })

  describe("simple plan", () => {
    const cases = [
      {
        name: "plan header and items contain steps and messages interleaved",
        history: [
          userBlock("Help me"),
          ...submitPlanCall("Build feature", ["Design", "Implement"]),
          textBlock("Starting design"),
          ...completeStepCall(),
          textBlock("Now implementing"),
        ],
        check: (result: GroupedMessage[]) => {
          expect(result[0].type).toBe("text")
          const header = mustFind(result, isPlanHeader)
          expect(header.task).toBe("Build feature")
          expect(header.completed).toBe(false)
          expect(header.aborted).toBe(false)
          const steps = planSteps(result)
          expect(steps).toHaveLength(2)
          expect(steps[0].status).toBe("completed")
          expect(steps[1].status).toBe("active")
          const textLeaf = result.find(
            (m) =>
              m.type === "plan-item" &&
              m.child.type === "text" &&
              m.child.content === "Starting design"
          )
          expect(textLeaf).toBeDefined()
        },
      },
      {
        name: "completed plan has completed flag and all steps completed",
        history: [...submitPlanCall("Task", ["Step 1"]), ...completeStepCall()],
        check: (result: GroupedMessage[]) => {
          const header = mustFind(result, isPlanHeader)
          expect(header.completed).toBe(true)
          expect(header.aborted).toBe(false)
          const steps = planSteps(result)
          expect(steps[0].status).toBe("completed")
        },
      },
      {
        name: "cancelled plan has aborted flag and cancelled step",
        history: [...submitPlanCall("Task", ["Step 1", "Step 2"]), ...cancelCall()],
        check: (result: GroupedMessage[]) => {
          const header = mustFind(result, isPlanHeader)
          expect(header.aborted).toBe(true)
          expect(header.completed).toBe(false)
          const steps = planSteps(result)
          expect(steps[0].status).toBe("cancelled")
          expect(steps[1].status).toBe("pending")
        },
      },
      {
        name: "all plan items have dimmed=false for simple plans",
        history: [...submitPlanCall("Task", ["Step 1", "Step 2"]), textBlock("Working")],
        check: (result: GroupedMessage[]) => {
          const items = result.filter(isPlanItem)
          expect(items.length).toBeGreaterThan(0)
          items.forEach((item) => {
            expect(item.dimmed).toBe(false)
          })
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(group(history)))
  })

  describe("nested steps", () => {
    const cases = [
      {
        name: "nested steps are flattened as plan items",
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

  describe("messages before and after plan", () => {
    const cases = [
      {
        name: "assistant text in silent steps is visible as plan items",
        history: [
          userBlock("Before plan"),
          textBlock("Response before"),
          ...submitPlanCall("Task", ["Step 1"]),
          textBlock("Inside plan"),
        ],
        check: (result: GroupedMessage[]) => {
          expect(result[0].type).toBe("text")
          expect(result[1].type).toBe("text")
          expect(result[2].type).toBe("plan-header")
          const textItems = result.filter((m) => m.type === "plan-item" && m.child.type === "text")
          expect(textItems).toHaveLength(1)
        },
      },
      {
        name: "assistant text in checkpoint steps is visible",
        history: [
          ...submitPlanCall("Task", [{ title: "Step 1", expected: "done", checkpoint: true }]),
          textBlock("Waiting for confirmation"),
        ],
        check: (result: GroupedMessage[]) => {
          const textItems = result.filter((m) => m.type === "plan-item" && m.child.type === "text")
          expect(textItems).toHaveLength(1)
        },
      },
      {
        name: "user messages in silent steps survive",
        history: [...submitPlanCall("Task", ["Step 1"]), userBlock("User interruption")],
        check: (result: GroupedMessage[]) => {
          const textItems = result.filter((m) => m.type === "plan-item" && m.child.type === "text")
          expect(textItems).toHaveLength(1)
          expect((textItems[0] as PlanItem).child).toEqual({
            type: "text",
            role: "user",
            content: "User interruption",
          })
        },
      },
      {
        name: "messages after completed plan are leaves, not plan items",
        history: [
          ...submitPlanCall("Task", ["Step 1"]),
          textBlock("Inside plan"),
          ...completeStepCall(),
          userBlock("After completion"),
          textBlock("Back to chat"),
        ],
        check: (result: GroupedMessage[]) => {
          const planItems = result.filter((m) => m.type === "plan-item" && m.child.type === "text")
          expect(planItems).toHaveLength(1)
          const leaves = result.filter((m) => m.type === "text")
          expect(leaves).toHaveLength(2)
          expect(leaves[0]).toEqual({ type: "text", role: "user", content: "After completion" })
          expect(leaves[1]).toEqual({ type: "text", role: "assistant", content: "Back to chat" })
        },
      },
      {
        name: "messages after cancelled plan are leaves",
        history: [
          ...submitPlanCall("Task", ["Step 1", "Step 2"]),
          ...cancelCall(),
          textBlock("Back to normal"),
        ],
        check: (result: GroupedMessage[]) => {
          const leaves = result.filter((m) => m.type === "text")
          expect(leaves).toHaveLength(1)
          expect(leaves[0]).toEqual({ type: "text", role: "assistant", content: "Back to normal" })
        },
      },
      {
        name: "messages between two plans belong to the earlier plan",
        history: [
          ...submitPlanCall("First", ["Step 1"]),
          ...completeStepCall(),
          textBlock("Between plans"),
          ...submitPlanCall("Second", ["Step 2"]),
        ],
        check: (result: GroupedMessage[]) => {
          const headers = result.filter(isPlanHeader)
          expect(headers).toHaveLength(2)
          expect(headers[0].task).toBe("First")
          expect(headers[1].task).toBe("Second")
          const leaves = result.filter((m) => m.type === "text")
          expect(leaves).toHaveLength(1)
          expect(leaves[0]).toEqual({ type: "text", role: "assistant", content: "Between plans" })
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(group(history)))
  })

  describe("multiple plans", () => {
    const cases = [
      {
        name: "each plan gets its own PlanHeader",
        history: [
          ...submitPlanCall("First task", ["Step A"]),
          textBlock("Working on first"),
          ...cancelCall(),
          ...submitPlanCall("Second task", ["Step B"]),
          textBlock("Working on second"),
        ],
        check: (result: GroupedMessage[]) => {
          const headers = result.filter(isPlanHeader)
          expect(headers).toHaveLength(2)
          expect(headers[0].task).toBe("First task")
          expect(headers[0].aborted).toBe(true)
          expect(headers[1].task).toBe("Second task")
          expect(headers[1].aborted).toBe(false)
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(group(history)))
  })

  describe("streaming not in message list", () => {
    const cases = [
      {
        name: "assistant text in silent step is visible in grouped output",
        history: [...submitPlanCall("Task", ["Step 1"]), textBlock("Working")],
        check: (result: GroupedMessage[]) => {
          const textItems = result.filter(
            (m) => (m.type === "plan-item" && m.child.type === "text") || m.type === "text"
          )
          expect(textItems).toHaveLength(1)
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(group(history)))
  })
})
