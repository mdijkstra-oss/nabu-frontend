import { describe, expect, it, beforeEach } from "vitest"
import type { Block } from "~/lib/agent/client/blocks"
import {
  toRenderMessages,
  extractAskMessages,
  isWaitingForAsk,
  type RenderMessage,
} from "./messages"
import {
  submitPlanCall,
  completeStepCall,
  cancelCall,
  askCall,
  askCallPending,
  resetCallIdCounter,
  userBlock,
  textBlock,
  systemBlock,
  toolResult,
} from "~/lib/agent/test-helpers"

beforeEach(() => resetCallIdCounter())

describe("toRenderMessages", () => {
  describe("text messages", () => {
    const cases = [
      {
        name: "user block renders as user text message",
        history: [userBlock("Hello")],
        expected: [{ type: "text", role: "user", content: "Hello" }],
      },
      {
        name: "text block renders as assistant text message",
        history: [textBlock("Hi there")],
        expected: [{ type: "text", role: "assistant", content: "Hi there" }],
      },
      {
        name: "empty content is filtered out",
        history: [userBlock(""), textBlock("   "), userBlock("Real message")],
        expected: [{ type: "text", role: "user", content: "Real message" }],
      },
      {
        name: "system blocks do not render",
        history: [systemBlock("System prompt"), userBlock("Hello")],
        expected: [{ type: "text", role: "user", content: "Hello" }],
      },
      {
        name: "tool_result blocks do not render",
        history: [userBlock("Hello"), toolResult("1")],
        expected: [{ type: "text", role: "user", content: "Hello" }],
      },
    ]

    it.each(cases)("$name", ({ history, expected }) => {
      expect(toRenderMessages(history)).toEqual(expected)
    })
  })

  describe("plan messages", () => {
    const cases = [
      {
        name: "submit_plan renders as plan message with all steps pending",
        history: [...submitPlanCall("Build feature", ["Design", "Implement", "Test"])],
        check: (messages: RenderMessage[]) => {
          expect(messages).toHaveLength(1)
          expect(messages[0].type).toBe("plan")
          if (messages[0].type === "plan") {
            expect(messages[0].plan.task).toBe("Build feature")
            expect(messages[0].plan.steps).toHaveLength(3)
            expect(messages[0].currentStep).toBe(0)
            expect(messages[0].aborted).toBe(false)
          }
        },
      },
      {
        name: "completed steps are marked done",
        history: [
          ...submitPlanCall("Task", ["Step 1", "Step 2", "Step 3"]),
          ...completeStepCall(),
          ...completeStepCall(),
        ],
        check: (messages: RenderMessage[]) => {
          expect(messages).toHaveLength(1)
          if (messages[0].type === "plan") {
            expect(messages[0].plan.steps[0].done).toBe(true)
            expect(messages[0].plan.steps[1].done).toBe(true)
            expect(messages[0].plan.steps[2].done).toBe(false)
            expect(messages[0].currentStep).toBe(2)
          }
        },
      },
      {
        name: "all steps complete sets currentStep to null",
        history: [
          ...submitPlanCall("Task", ["Step 1", "Step 2"]),
          ...completeStepCall(),
          ...completeStepCall(),
        ],
        check: (messages: RenderMessage[]) => {
          expect(messages).toHaveLength(1)
          if (messages[0].type === "plan") {
            expect(messages[0].currentStep).toBe(null)
            expect(messages[0].aborted).toBe(false)
          }
        },
      },
      {
        name: "aborted plan shows aborted state",
        history: [
          ...submitPlanCall("Task", ["Step 1", "Step 2", "Step 3"]),
          ...completeStepCall(),
          ...cancelCall(),
        ],
        check: (messages: RenderMessage[]) => {
          expect(messages).toHaveLength(1)
          if (messages[0].type === "plan") {
            expect(messages[0].plan.steps[0].done).toBe(true)
            expect(messages[0].plan.steps[1].done).toBe(false)
            expect(messages[0].aborted).toBe(true)
          }
        },
      },
      {
        name: "complete_step does not render as separate message",
        history: [...submitPlanCall("Task", ["Step 1"]), ...completeStepCall()],
        check: (messages: RenderMessage[]) => {
          expect(messages).toHaveLength(1)
          expect(messages[0].type).toBe("plan")
        },
      },
      {
        name: "cancel does not render as separate message",
        history: [...submitPlanCall("Task", ["Step 1"]), ...cancelCall()],
        check: (messages: RenderMessage[]) => {
          expect(messages).toHaveLength(1)
          expect(messages[0].type).toBe("plan")
        },
      },
      {
        name: "new plan after cancel shows only new plan",
        history: [
          ...submitPlanCall("First task", ["Step A"]),
          ...cancelCall(),
          ...submitPlanCall("Second task", ["Step B"]),
        ],
        check: (messages: RenderMessage[]) => {
          expect(messages).toHaveLength(2)
          if (messages[0].type === "plan" && messages[1].type === "plan") {
            expect(messages[0].plan.task).toBe("First task")
            expect(messages[0].aborted).toBe(true)
            expect(messages[1].plan.task).toBe("Second task")
            expect(messages[1].aborted).toBe(false)
          }
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(toRenderMessages(history)))
  })

  describe("mixed history", () => {
    const cases = [
      {
        name: "user message then plan then text response",
        history: [
          userBlock("Help me build a feature"),
          ...submitPlanCall("Build feature", ["Step 1", "Step 2"]),
          textBlock("I'll help you with that"),
        ],
        check: (messages: RenderMessage[]) => {
          expect(messages).toHaveLength(3)
          expect(messages[0].type).toBe("text")
          expect(messages[1].type).toBe("plan")
          expect(messages[2].type).toBe("text")
        },
      },
    ]

    it.each(cases)("$name", ({ history, check }) => check(toRenderMessages(history)))
  })
})

describe("extractAskMessages", () => {
  const cases = [
    {
      name: "no ask blocks returns empty",
      history: [userBlock("Hello"), textBlock("Hi")],
      check: (result: ReturnType<typeof extractAskMessages>) => {
        expect(result.messages).toEqual([])
        expect(result.consumedUserIndices.size).toBe(0)
      },
    },
    {
      name: "pending question has selected null",
      history: [...askCallPending("Pick one", ["A", "B"])],
      check: (result: ReturnType<typeof extractAskMessages>) => {
        expect(result.messages).toHaveLength(1)
        expect(result.messages[0].message.question).toBe("Pick one")
        expect(result.messages[0].message.options).toEqual([
          { label: "A", expected: "A selected" },
          { label: "B", expected: "B selected" },
        ])
        expect(result.messages[0].message.selected).toBeNull()
      },
    },
    {
      name: "answered question has selected from result output",
      history: [...askCall("Pick one", ["A", "B"], "A")],
      check: (result: ReturnType<typeof extractAskMessages>) => {
        expect(result.messages).toHaveLength(1)
        expect(result.messages[0].message.selected).toBe("A")
      },
    },
    {
      name: "consumed user block between ask and result is tracked",
      history: [...askCall("Pick", ["X", "Y"], "X")],
      check: (result: ReturnType<typeof extractAskMessages>) => {
        expect(result.consumedUserIndices.size).toBe(1)
        expect(result.consumedUserIndices.has(1)).toBe(true)
      },
    },
    {
      name: "multiple sequential ask calls all extracted",
      history: [...askCall("Q1", ["A", "B"], "A"), ...askCall("Q2", ["C", "D"], "D")],
      check: (result: ReturnType<typeof extractAskMessages>) => {
        expect(result.messages).toHaveLength(2)
        expect(result.messages[0].message.question).toBe("Q1")
        expect(result.messages[0].message.selected).toBe("A")
        expect(result.messages[1].message.question).toBe("Q2")
        expect(result.messages[1].message.selected).toBe("D")
      },
    },
    {
      name: "pending ask with user answer shows selection before result",
      history: (() => {
        const id = "99"
        return [
          {
            type: "tool_call" as const,
            calls: [
              {
                id,
                name: "ask",
                args: {
                  question: "Pick",
                  options: [
                    { label: "A", expected: "A expected" },
                    { label: "B", expected: "B expected" },
                  ],
                },
              },
            ],
          },
          { type: "user" as const, content: "A" },
        ]
      })(),
      check: (result: ReturnType<typeof extractAskMessages>) => {
        expect(result.messages).toHaveLength(1)
        expect(result.messages[0].message.question).toBe("Pick")
        expect(result.messages[0].message.selected).toBe("A")
      },
    },
  ]

  it.each(cases)("$name", ({ history, check }) => check(extractAskMessages(history as Block[])))
})

describe("isWaitingForAsk", () => {
  const cases: { name: string; history: Block[]; expected: boolean }[] = [
    {
      name: "no waiting blocks returns false",
      history: [userBlock("Hello"), textBlock("Hi")],
      expected: false,
    },
    {
      name: "pending ask returns true",
      history: [...askCallPending("Pick one", ["A", "B"])],
      expected: true,
    },
    {
      name: "answered ask returns false",
      history: [...askCall("Pick one", ["A", "B"], "A")],
      expected: false,
    },
    {
      name: "ask followed by text returns false",
      history: [...askCallPending("Pick", ["A", "B"]), textBlock("Continuing")],
      expected: false,
    },
    {
      name: "ask followed by user returns false",
      history: [...askCallPending("Pick", ["A", "B"]), userBlock("My answer")],
      expected: false,
    },
    {
      name: "answered ask then new pending ask returns true",
      history: [...askCall("Q1", ["A", "B"], "A"), ...askCallPending("Q2", ["C", "D"])],
      expected: true,
    },
    {
      name: "draft ask tool call returns false",
      history: [
        {
          type: "tool_call" as const,
          calls: [{ id: "", name: "ask", args: {} }],
          draft: true as const,
        },
      ],
      expected: false,
    },
  ]

  it.each(cases)("$name", ({ history, expected }) => {
    expect(isWaitingForAsk(history)).toBe(expected)
  })
})
