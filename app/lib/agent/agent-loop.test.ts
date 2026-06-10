import { describe, expect, it } from "vitest"
import type { Block } from "./client/blocks"
import {
  shouldContinue,
  hasToolCalls,
  excludeReasoning,
  isRejectionBlock,
  hasRejection,
} from "./agent-loop"
import { hasNewUserBlock } from "./executors/delegation"
import { deriveMode } from "./executors/modes"
import { textBlock, userBlock, toolCallBlock, terminalResult, toolResult } from "./test-helpers"

describe("shouldContinue", () => {
  const cases: { name: string; blocks: Block[]; expected: boolean }[] = [
    {
      name: "text only → false (stop)",
      blocks: [textBlock("Hello")],
      expected: false,
    },
    {
      name: "no text no tools → false (stop)",
      blocks: [{ type: "system", content: "nudge" } as Block],
      expected: false,
    },
    {
      name: "tool calls → true (continue)",
      blocks: [toolCallBlock("search", "c1")],
      expected: true,
    },
    {
      name: "mixed text+tools → true (continue)",
      blocks: [textBlock("thinking..."), toolCallBlock("search", "c1")],
      expected: true,
    },
    {
      name: "empty → false (stop)",
      blocks: [],
      expected: false,
    },
    {
      name: "reasoning only → false (stop)",
      blocks: [{ type: "reasoning", content: "thinking" } as Block],
      expected: false,
    },
  ]

  it.each(cases)("$name", ({ blocks, expected }) => {
    expect(shouldContinue(blocks)).toBe(expected)
  })
})

describe("isRejectionBlock", () => {
  const cases: { name: string; block: Block; expected: boolean }[] = [
    {
      name: "rejection system block → true",
      block: {
        type: "system",
        content: "Your response was rejected. These entity IDs do not exist: abc",
      } as Block,
      expected: true,
    },
    {
      name: "other system block → false",
      block: { type: "system", content: "some nudge" } as Block,
      expected: false,
    },
    {
      name: "text block → false",
      block: textBlock("Your response was rejected."),
      expected: false,
    },
  ]

  it.each(cases)("$name", ({ block, expected }) => {
    expect(isRejectionBlock(block)).toBe(expected)
  })
})

describe("hasRejection", () => {
  const cases: { name: string; blocks: Block[]; expected: boolean }[] = [
    {
      name: "contains rejection → true",
      blocks: [
        { type: "system", content: "Your response was rejected. IDs: abc" } as Block,
        textBlock("retry"),
      ],
      expected: true,
    },
    {
      name: "no rejection → false",
      blocks: [textBlock("hello"), { type: "system", content: "nudge" } as Block],
      expected: false,
    },
    {
      name: "empty → false",
      blocks: [],
      expected: false,
    },
  ]

  it.each(cases)("$name", ({ blocks, expected }) => {
    expect(hasRejection(blocks)).toBe(expected)
  })
})

describe("hasNewUserBlock", () => {
  const cases: { name: string; blocks: Block[]; before: number; expected: boolean }[] = [
    {
      name: "user block after marker → true",
      blocks: [textBlock("old"), userBlock("new message")],
      before: 1,
      expected: true,
    },
    {
      name: "system block after marker → false",
      blocks: [textBlock("old"), { type: "system", content: "nudge" } as Block],
      before: 1,
      expected: false,
    },
    {
      name: "no new blocks → false",
      blocks: [textBlock("old")],
      before: 1,
      expected: false,
    },
    {
      name: "multiple new blocks with user → true",
      blocks: [textBlock("old"), { type: "system", content: "ctx" } as Block, userBlock("hello")],
      before: 1,
      expected: true,
    },
    {
      name: "multiple new blocks without user → false",
      blocks: [
        textBlock("old"),
        { type: "system", content: "a" } as Block,
        { type: "system", content: "b" } as Block,
      ],
      before: 1,
      expected: false,
    },
  ]

  it.each(cases)("$name", ({ blocks, before, expected }) => {
    expect(hasNewUserBlock(blocks, before)).toBe(expected)
  })
})

describe("hasToolCalls", () => {
  const cases: { name: string; blocks: Block[]; expected: boolean }[] = [
    { name: "empty → false", blocks: [], expected: false },
    { name: "text only → false", blocks: [textBlock("hi")], expected: false },
    { name: "has tool_call → true", blocks: [toolCallBlock("search", "c1")], expected: true },
    {
      name: "mixed → true",
      blocks: [textBlock("hi"), toolCallBlock("search", "c1")],
      expected: true,
    },
  ]

  it.each(cases)("$name", ({ blocks, expected }) => {
    expect(hasToolCalls(blocks)).toBe(expected)
  })
})

describe("excludeReasoning", () => {
  const cases: { name: string; blocks: Block[]; expected: Block[] }[] = [
    {
      name: "removes reasoning",
      blocks: [textBlock("hi"), { type: "reasoning", content: "think" }],
      expected: [textBlock("hi")],
    },
    {
      name: "keeps everything else",
      blocks: [textBlock("hi"), userBlock("yo")],
      expected: [textBlock("hi"), userBlock("yo")],
    },
  ]

  it.each(cases)("$name", ({ blocks, expected }) => {
    expect(excludeReasoning(blocks)).toEqual(expected)
  })
})

describe("deriveMode", () => {
  const cases: { name: string; blocks: Block[]; expected: string }[] = [
    {
      name: "empty blocks → chat",
      blocks: [],
      expected: "chat",
    },
    {
      name: "no trigger tool_results → chat",
      blocks: [textBlock("hi"), toolCallBlock("search", "c1"), toolResult("c1", { status: "ok" })],
      expected: "chat",
    },
    {
      name: "start_planning pushes prompt marker → plan",
      blocks: [
        toolCallBlock("start_planning", "c1"),
        toolResult("c1", { status: "ok", output: "Planning mode." }),
        { type: "system", content: "<!-- prompt: planning -->" } as Block,
      ],
      expected: "plan",
    },
    {
      name: "submit_plan result → exec",
      blocks: [
        { type: "system", content: "<!-- prompt: planning -->" } as Block,
        toolCallBlock("submit_plan", "c2", { task: "do stuff", steps: [] }),
        terminalResult("submit_plan", "c2", { status: "ok", output: "exec mode" }),
      ],
      expected: "exec",
    },
    {
      name: "cancel result → chat",
      blocks: [
        { type: "system", content: "<!-- prompt: planning -->" } as Block,
        terminalResult("cancel", "c2", { status: "ok", output: { reason: "nah" } }),
      ],
      expected: "chat",
    },
    {
      name: "uses last signal (plan then exec)",
      blocks: [
        { type: "system", content: "<!-- prompt: planning -->" } as Block,
        textBlock("here's the plan"),
        terminalResult("submit_plan", "c2", { status: "ok", output: "exec" }),
      ],
      expected: "exec",
    },
    {
      name: "prompt marker survives non-trigger results",
      blocks: [
        { type: "system", content: "<!-- prompt: planning -->" } as Block,
        toolCallBlock("run_local_shell", "c2"),
        toolResult("c2", { status: "ok", output: "file content" }),
        textBlock("analyzing..."),
      ],
      expected: "plan",
    },
  ]

  it.each(cases)("$name", ({ blocks, expected }) => {
    expect(deriveMode(blocks)).toBe(expected)
  })
})
