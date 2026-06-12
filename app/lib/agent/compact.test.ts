import { describe, expect, it } from "vitest"
import { compactHistory, stepCompactHistory, stepCompactedIndices } from "./compact"
import type { Block } from "./client/blocks"
import { serializePlanBlock } from "./derived"
import { userBlock, textBlock, systemBlock, reasoningBlock } from "./test-helpers"

const compactedToolCall = (summary: string): Block => ({
  type: "tool_call",
  calls: [{ id: "compact_0", name: "compacted", args: { summary } }],
})

const compactedResult = (): Block => ({
  type: "tool_result",
  callId: "compact_0",
  toolName: "compacted",
  result: { status: "ok", output: "ok" },
})

const toolResult = (callId: string, name: string, result: unknown): Block => ({
  type: "tool_result",
  callId,
  toolName: name,
  result,
})

const submitPlanBlocks = (task: string, steps: { title: string; expected: string }[]): Block[] => [
  {
    type: "tool_call",
    calls: [{ id: "plan_0", name: "submit_plan", args: { task, steps } }],
  },
  { type: "system", content: serializePlanBlock(task, steps, []) },
  {
    type: "tool_result",
    callId: "plan_0",
    toolName: "submit_plan",
    result: { status: "ok", output: "ok" },
  },
]

const completeStepCall = (internal: string, id = "cs_0"): Block => ({
  type: "tool_call",
  calls: [{ id, name: "complete_step", args: { internal } }],
})

const completeStepResult = (id = "cs_0"): Block => ({
  type: "tool_result",
  callId: id,
  toolName: "complete_step",
  result: { status: "ok" },
})

const workCall = (name: string, id = "w_0"): Block => ({
  type: "tool_call",
  calls: [{ id, name, args: {} }],
})

const workResult = (name: string, id = "w_0"): Block => ({
  type: "tool_result",
  callId: id,
  toolName: name,
  result: { status: "ok", output: "data" },
})

describe("compactHistory", () => {
  const cases = [
    {
      name: "no compacted in history — blocks unchanged",
      blocks: [userBlock("hi"), textBlock("hello")],
      files: {},
      expected: [userBlock("hi"), textBlock("hello")],
    },
    {
      name: "compacted at end — preserves pending user block",
      blocks: [
        userBlock("hi"),
        textBlock("hello"),
        userBlock("do something"),
        compactedToolCall("Summary of conversation"),
        compactedResult(),
      ],
      files: {},
      expected: [systemBlock("Summary of conversation"), userBlock("do something")],
    },
    {
      name: "compacted at end — preserves pending tool_result",
      blocks: [
        userBlock("hi"),
        textBlock("hello"),
        toolResult("c1", "shell", { output: "file contents" }),
        compactedToolCall("Summary of conversation"),
        compactedResult(),
      ],
      files: {},
      expected: [
        systemBlock("Summary of conversation"),
        toolResult("c1", "shell", { output: "file contents" }),
      ],
    },
    {
      name: "compacted at end — skips text blocks when finding pending",
      blocks: [
        userBlock("hi"),
        textBlock("hello"),
        compactedToolCall("Summary"),
        compactedResult(),
      ],
      files: {},
      expected: [systemBlock("Summary"), userBlock("hi")],
    },
    {
      name: "compacted at end, active plan — preserves pending + plan context",
      blocks: [
        ...submitPlanBlocks("Analyze data", [
          { title: "Read files", expected: "Files loaded" },
          { title: "Process data", expected: "Data processed" },
        ]),
        userBlock("go"),
        textBlock("working on it"),
        compactedToolCall("We are analyzing data"),
        compactedResult(),
      ],
      files: {},
      expected: [
        systemBlock(
          "We are analyzing data\n\nActive plan: Analyze data\n" +
            "[now ] Read files\n" +
            "[    ] Process data"
        ),
        userBlock("go"),
      ],
    },
    {
      name: "compacted with blocks after — pending + trailing",
      blocks: [
        userBlock("hi"),
        compactedToolCall("Earlier conversation"),
        compactedResult(),
        userBlock("continue"),
        textBlock("sure"),
      ],
      files: {},
      expected: [
        systemBlock("Earlier conversation"),
        userBlock("hi"),
        userBlock("continue"),
        textBlock("sure"),
      ],
    },
    {
      name: "multiple compacted calls — last one wins with pending",
      blocks: [
        compactedToolCall("First summary"),
        compactedResult(),
        userBlock("more work"),
        textBlock("doing things"),
        compactedToolCall("Second summary"),
        compactedResult(),
        userBlock("final"),
      ],
      files: {},
      expected: [systemBlock("Second summary"), userBlock("more work"), userBlock("final")],
    },
    {
      name: "collects directive blocks from pre-compaction history",
      blocks: [
        systemBlock("<!-- prompt: planning -->"),
        systemBlock("<!-- tier: fast -->"),
        userBlock("hi"),
        compactedToolCall("Summary here"),
        compactedResult(),
      ],
      files: {},
      expected: [
        systemBlock("Summary here"),
        systemBlock("<!-- prompt: planning -->"),
        systemBlock("<!-- tier: fast -->"),
        userBlock("hi"),
      ],
    },
    {
      name: "last directive per key wins",
      blocks: [
        systemBlock("<!-- prompt: planning -->"),
        userBlock("hi"),
        systemBlock("<!-- prompt: execution -->"),
        compactedToolCall("Summary"),
        compactedResult(),
        userBlock("continue"),
      ],
      files: {},
      expected: [
        systemBlock("Summary"),
        systemBlock("<!-- prompt: execution -->"),
        userBlock("hi"),
        userBlock("continue"),
      ],
    },
    {
      name: "no pending block found — no user or tool_result before compaction",
      blocks: [textBlock("just text"), compactedToolCall("Summary"), compactedResult()],
      files: {},
      expected: [systemBlock("Summary")],
    },
  ]

  it.each(cases)("$name", ({ blocks, files, expected }) => {
    const result = compactHistory(blocks, files)
    expect(result).toEqual(expected)
  })
})

describe("stepCompactHistory", () => {
  const planA = submitPlanBlocks("Task", [{ title: "A", expected: "done" }])
  const planAB = submitPlanBlocks("Task", [
    { title: "A", expected: "done" },
    { title: "B", expected: "done" },
  ])
  const planABC = submitPlanBlocks("Task", [
    { title: "A", expected: "done" },
    { title: "B", expected: "done" },
    { title: "C", expected: "done" },
  ])

  const cases = [
    {
      name: "no plan — blocks unchanged",
      blocks: [userBlock("hi"), textBlock("hello")],
      expected: [userBlock("hi"), textBlock("hello")],
    },
    {
      name: "plan with no completed steps — blocks unchanged",
      blocks: [
        ...planA,
        textBlock("working"),
        workCall("run_local_shell", "w1"),
        workResult("run_local_shell", "w1"),
      ],
      expected: [
        ...planA,
        textBlock("working"),
        workCall("run_local_shell", "w1"),
        workResult("run_local_shell", "w1"),
      ],
    },
    {
      name: "one completed step — filters work blocks, keeps boundaries",
      blocks: [
        ...planAB,
        systemBlock("mode: exec"),
        textBlock("working on A"),
        workCall("run_local_shell", "w1"),
        workResult("run_local_shell", "w1"),
        reasoningBlock("thinking"),
        completeStepCall("found 3 items"),
        completeStepResult(),
        textBlock("now B"),
      ],
      expected: [
        ...planAB,
        systemBlock("mode: exec"),
        completeStepCall("found 3 items"),
        completeStepResult(),
        textBlock("now B"),
      ],
    },
    {
      name: "user block within completed step survives",
      blocks: [
        ...planA,
        textBlock("working"),
        userBlock("checkpoint"),
        completeStepCall("ctx"),
        completeStepResult(),
      ],
      expected: [...planA, userBlock("checkpoint"), completeStepCall("ctx"), completeStepResult()],
    },
    {
      name: "compacted tool_call/result within step survives",
      blocks: [
        ...planA,
        textBlock("working"),
        compactedToolCall("Mid-step summary"),
        compactedResult(),
        workCall("run_local_shell", "w1"),
        workResult("run_local_shell", "w1"),
        completeStepCall("ctx"),
        completeStepResult(),
      ],
      expected: [
        ...planA,
        compactedToolCall("Mid-step summary"),
        compactedResult(),
        completeStepCall("ctx"),
        completeStepResult(),
      ],
    },
    {
      name: "two completed steps — both compacted, in-progress untouched",
      blocks: [
        ...planABC,
        textBlock("step A"),
        workCall("run_local_shell", "w1"),
        workResult("run_local_shell", "w1"),
        completeStepCall("ctx-a", "cs1"),
        completeStepResult("cs1"),
        textBlock("step B"),
        workCall("edit_file", "w2"),
        workResult("edit_file", "w2"),
        completeStepCall("ctx-b", "cs2"),
        completeStepResult("cs2"),
        textBlock("step C in progress"),
        workCall("run_local_shell", "w3"),
        workResult("run_local_shell", "w3"),
      ],
      expected: [
        ...planABC,
        completeStepCall("ctx-a", "cs1"),
        completeStepResult("cs1"),
        completeStepCall("ctx-b", "cs2"),
        completeStepResult("cs2"),
        textBlock("step C in progress"),
        workCall("run_local_shell", "w3"),
        workResult("run_local_shell", "w3"),
      ],
    },
    {
      name: "blocks before submit_plan are untouched",
      blocks: [
        userBlock("hi"),
        textBlock("planning..."),
        ...planA,
        textBlock("working"),
        completeStepCall("ctx"),
        completeStepResult(),
      ],
      expected: [
        userBlock("hi"),
        textBlock("planning..."),
        ...planA,
        completeStepCall("ctx"),
        completeStepResult(),
      ],
    },
  ]

  it.each(cases)("$name", ({ blocks, expected }) => {
    expect(stepCompactHistory(blocks)).toEqual(expected)
  })
})

describe("stepCompactedIndices", () => {
  const cases = [
    {
      name: "no plan — empty set",
      blocks: [userBlock("hi"), textBlock("hello")],
      expected: new Set<number>(),
    },
    {
      name: "one completed step — returns work block indices",
      blocks: [
        ...submitPlanBlocks("Task", [{ title: "A", expected: "done" }]),
        textBlock("working"),
        workCall("run_local_shell", "w1"),
        workResult("run_local_shell", "w1"),
        completeStepCall("ctx"),
        completeStepResult(),
      ],
      expected: new Set([3, 4, 5]),
    },
    {
      name: "system and user blocks not in compacted set",
      blocks: [
        ...submitPlanBlocks("Task", [{ title: "A", expected: "done" }]),
        systemBlock("mode"),
        userBlock("checkpoint"),
        textBlock("working"),
        completeStepCall("ctx"),
        completeStepResult(),
      ],
      expected: new Set([5]),
    },
  ]

  it.each(cases)("$name", ({ blocks, expected }) => {
    expect(stepCompactedIndices(blocks)).toEqual(expected)
  })
})
