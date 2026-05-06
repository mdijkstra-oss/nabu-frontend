import { describe, expect, it, beforeEach } from "vitest"
import type { Block } from "../client/blocks"
import {
  derive,
  lastPlan,
  hasActivePlan,
  getMode,
  isPlanPaused,
  guardCompleteStep,
  isLastStep,
} from "."
import {
  submitPlanCall,
  completeStepCall,
  cancelCall,
  textBlock,
  userBlock,
  resetCallIdCounter,
} from "../test-helpers"

const mustGet = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("expected non-null value")
  return value
}

beforeEach(() => resetCallIdCounter())

describe("derived", () => {
  describe("plan", () => {
    const cases = [
      {
        name: "no history returns null plan",
        history: [] as Block[],
        check: (history: Block[]) => {
          const d = derive(history)
          expect(lastPlan(d.plans)).toBe(null)
          expect(hasActivePlan(d.plans)).toBe(false)
        },
      },
      {
        name: "submit_plan creates plan",
        history: [
          ...submitPlanCall("Test task", [
            { title: "Step 1", expected: "Done 1" },
            { title: "Step 2", expected: "Done 2" },
          ]),
        ],
        check: (history: Block[]) => {
          const d = derive(history)
          const plan = lastPlan(d.plans)
          expect(plan?.task).toBe("Test task")
          expect(plan?.steps).toHaveLength(2)
          expect(plan?.currentStep).toBe(0)
          expect(hasActivePlan(d.plans)).toBe(true)
        },
      },
      {
        name: "complete_step marks step done and advances",
        history: [
          ...submitPlanCall("Task", [
            { title: "Step 1", expected: "Done 1" },
            { title: "Step 2", expected: "Done 2" },
          ]),
          ...completeStepCall(),
        ],
        check: (history: Block[]) => {
          const d = derive(history)
          const plan = lastPlan(d.plans)
          expect(plan?.steps[0].done).toBe(true)
          expect(plan?.steps[1].done).toBe(false)
          expect(plan?.currentStep).toBe(1)
        },
      },
      {
        name: "complete_step stores internal context",
        history: [
          ...submitPlanCall("Task", [{ title: "Step 1", expected: "Complete" }]),
          ...completeStepCall("id:123, count:5"),
        ],
        check: (history: Block[]) => {
          const d = derive(history)
          const plan = lastPlan(d.plans)
          expect(plan?.steps[0].internal).toBe("id:123, count:5")
        },
      },
      {
        name: "all steps complete returns null currentStep",
        history: [
          ...submitPlanCall("Task", [
            { title: "Step 1", expected: "Done 1" },
            { title: "Step 2", expected: "Done 2" },
          ]),
          ...completeStepCall(),
          ...completeStepCall(),
        ],
        check: (history: Block[]) => {
          const d = derive(history)
          expect(lastPlan(d.plans)?.currentStep).toBe(null)
          expect(hasActivePlan(d.plans)).toBe(false)
        },
      },
      {
        name: "cancel marks plan as aborted",
        history: [
          ...submitPlanCall("Task", [{ title: "Step 1", expected: "Complete" }]),
          ...cancelCall(),
        ],
        check: (history: Block[]) => {
          const d = derive(history)
          expect(lastPlan(d.plans)?.aborted).toBe(true)
          expect(hasActivePlan(d.plans)).toBe(false)
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(history))
  })

  describe("getMode", () => {
    const cases = [
      {
        name: "empty history returns chat",
        history: [] as Block[],
        expected: "chat",
      },
      {
        name: "active plan returns exec",
        history: [...submitPlanCall("Task", [{ title: "Step 1", expected: "Complete" }])],
        expected: "exec",
      },
      {
        name: "completed plan returns chat",
        history: [
          ...submitPlanCall("Task", [{ title: "Step 1", expected: "Complete" }]),
          ...completeStepCall(),
        ],
        expected: "chat",
      },
    ]

    it.each(cases)("$name", ({ history, expected }) => {
      expect(getMode(derive(history))).toBe(expected)
    })
  })

  describe("isPlanPaused", () => {
    const cases = [
      {
        name: "empty history is not paused",
        history: [] as Block[],
        expected: false,
      },
      {
        name: "right after submit_plan is not paused",
        history: [...submitPlanCall("Task", ["Step 1"])],
        expected: false,
      },
      {
        name: "text block after step boundary is paused",
        history: [...submitPlanCall("Task", ["Step 1"]), textBlock("Let me ask you something")],
        expected: true,
      },
      {
        name: "text block followed by user message is still paused",
        history: [
          ...submitPlanCall("Task", ["Step 1"]),
          textBlock("What should I do?"),
          userBlock("Do this"),
        ],
        expected: true,
      },
      {
        name: "text block followed by tool call is still paused",
        history: [
          ...submitPlanCall("Task", ["Step 1"]),
          textBlock("Let me check"),
          {
            type: "tool_call" as const,
            calls: [{ id: "99", name: "shell", args: { command: "ls" } }],
          },
          { type: "tool_result" as const, callId: "99", result: { status: "ok" } },
        ],
        expected: true,
      },
      {
        name: "complete_step after text un-pauses",
        history: [
          ...submitPlanCall("Task", ["Step 1", "Step 2"]),
          textBlock("Pausing here"),
          userBlock("Continue"),
          ...completeStepCall(),
        ],
        expected: false,
      },
      {
        name: "no plan at all is not paused",
        history: [textBlock("Just chatting")],
        expected: false,
      },
    ]

    it.each(cases)("$name", ({ history, expected }) => {
      expect(isPlanPaused(history)).toBe(expected)
    })
  })

  describe("nested steps", () => {
    const cases = [
      {
        name: "creates plan with nested steps flattened",
        history: () => [
          ...submitPlanCall("Analyze docs", [
            { title: "Research", expected: "Research done" },
            { nested: ["Analyze", "Code"] },
            { title: "Summary", expected: "Summarized" },
          ]),
        ],
        check: (history: Block[]) => {
          const d = derive(history)
          const plan = lastPlan(d.plans)
          expect(plan?.steps).toHaveLength(4)
          expect(plan?.steps.map((s) => s.id)).toEqual(["1", "2.1", "2.2", "3"])
        },
      },
      {
        name: "nested steps advance linearly",
        history: () => [
          ...submitPlanCall("Task", [
            { title: "Pre", expected: "Pre done" },
            { nested: ["Inner 1", "Inner 2"] },
            { title: "Post", expected: "Post done" },
          ]),
          ...completeStepCall(),
          ...completeStepCall(),
        ],
        check: (history: Block[]) => {
          const plan = lastPlan(derive(history).plans)
          expect(plan?.currentStep).toBe(2)
          expect(plan?.steps[1].done).toBe(true)
          expect(plan?.steps[2].done).toBe(false)
        },
      },
      {
        name: "completing all nested steps advances to next top-level",
        history: () => [
          ...submitPlanCall("Task", [
            { nested: ["Analyze", "Code"] },
            { title: "Summary", expected: "Summarized" },
          ]),
          ...completeStepCall(),
          ...completeStepCall(),
        ],
        check: (history: Block[]) => {
          const plan = lastPlan(derive(history).plans)
          expect(plan?.currentStep).toBe(2)
          expect(plan?.steps[0].done).toBe(true)
          expect(plan?.steps[1].done).toBe(true)
          expect(plan?.steps[2].done).toBe(false)
        },
      },
      {
        name: "all steps complete including nested",
        history: () => [
          ...submitPlanCall("Task", [
            { nested: ["Process"] },
            { title: "Final", expected: "Final done" },
          ]),
          ...completeStepCall(),
          ...completeStepCall(),
        ],
        check: (history: Block[]) => {
          const plan = lastPlan(derive(history).plans)
          expect(plan?.currentStep).toBe(null)
          expect(hasActivePlan(derive(history).plans)).toBe(false)
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(history()))
  })

  describe("guards", () => {
    const cases = [
      {
        name: "guardCompleteStep: allowed on regular step",
        plan: () => {
          const history = [...submitPlanCall("Task", [{ title: "Regular", expected: "Done" }])]
          return mustGet(lastPlan(derive(history).plans))
        },
        guard: guardCompleteStep,
        expected: true,
      },
      {
        name: "guardCompleteStep: allowed on nested step",
        plan: () => {
          const history = [...submitPlanCall("Task", [{ nested: ["A", "B"] }])]
          return mustGet(lastPlan(derive(history).plans))
        },
        guard: guardCompleteStep,
        expected: true,
      },
      {
        name: "guardCompleteStep: denied when plan complete",
        plan: () => {
          const history = [
            ...submitPlanCall("Task", [{ title: "Step", expected: "Done" }]),
            ...completeStepCall(),
          ]
          return mustGet(lastPlan(derive(history).plans))
        },
        guard: guardCompleteStep,
        expected: false,
      },
    ]

    it.each(cases)("$name", ({ plan, guard, expected }) => {
      expect(guard(plan()).allowed).toBe(expected)
    })
  })

  describe("isLastStep", () => {
    const cases = [
      {
        name: "single step plan — first step is last",
        history: () => [...submitPlanCall("Task", [{ title: "Only", expected: "Done" }])],
        expected: true,
      },
      {
        name: "multi-step plan — first step is not last",
        history: () => [
          ...submitPlanCall("Task", [
            { title: "A", expected: "Done" },
            { title: "B", expected: "Done" },
          ]),
        ],
        expected: false,
      },
      {
        name: "multi-step plan — after completing first, second is last",
        history: () => [
          ...submitPlanCall("Task", [
            { title: "A", expected: "Done" },
            { title: "B", expected: "Done" },
          ]),
          ...completeStepCall(),
        ],
        expected: true,
      },
      {
        name: "completed plan — no current step",
        history: () => [
          ...submitPlanCall("Task", [{ title: "A", expected: "Done" }]),
          ...completeStepCall(),
        ],
        expected: false,
      },
      {
        name: "nested steps — last nested is not last if top-level follows",
        history: () => [
          ...submitPlanCall("Task", [
            { nested: ["Inner 1", "Inner 2"] },
            { title: "Final", expected: "Done" },
          ]),
          ...completeStepCall(),
        ],
        expected: false,
      },
      {
        name: "nested steps — final top-level after nested is last",
        history: () => [
          ...submitPlanCall("Task", [
            { nested: ["Inner 1", "Inner 2"] },
            { title: "Final", expected: "Done" },
          ]),
          ...completeStepCall(),
          ...completeStepCall(),
        ],
        expected: true,
      },
    ]

    it.each(cases)("$name", ({ history, expected }) => {
      const plan = mustGet(lastPlan(derive(history()).plans))
      expect(isLastStep(plan)).toBe(expected)
    })
  })
})
