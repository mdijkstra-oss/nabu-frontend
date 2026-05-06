import { describe, expect, it } from "vitest"
import { processLine, initialParseState } from "./parse"
import { blocksToMessages } from "./convert"
import type { Block } from "./blocks"

interface ParseCallbacks {
  onChunk?: (text: string) => void
  onToolArgsChunk?: (text: string) => void
  onReasoningChunk?: (text: string) => void
  onToolName?: (name: string) => void
  onToolCall?: (call: { id: string; name: string; args: Record<string, unknown> }) => void
}

interface TestContext {
  chunks: string[]
  toolArgsChunks: string[]
  reasoningChunks: string[]
  toolNames: string[]
}

const makeCallbacks = (ctx: TestContext): ParseCallbacks => ({
  onChunk: (text) => ctx.chunks.push(text),
  onToolArgsChunk: (text) => ctx.toolArgsChunks.push(text),
  onReasoningChunk: (text) => ctx.reasoningChunks.push(text),
  onToolName: (name) => ctx.toolNames.push(name),
})

const emptyCtx = (): TestContext => ({
  chunks: [],
  toolArgsChunks: [],
  reasoningChunks: [],
  toolNames: [],
})

const processLines = (lines: string[], callbacks: ParseCallbacks = {}) => {
  let state = initialParseState()
  for (const line of lines) {
    state = processLine(line, state, callbacks)
  }
  return state
}

const flushBlocks = (lines: string[], callbacks: ParseCallbacks = {}): Block[] => {
  const state = processLines(lines, callbacks)
  const blocks = [...state.blocks]
  if (state.reasoningContent)
    blocks.push({
      type: "reasoning",
      content: state.reasoningContent,
      id: state.reasoningId,
      encryptedContent: state.reasoningEncryptedContent,
      extraContent: state.reasoningExtraContent,
    })
  if (state.textContent) blocks.push({ type: "text", content: state.textContent })
  if (state.pendingToolCalls.length > 0)
    blocks.push({ type: "tool_call", calls: state.pendingToolCalls })
  return blocks
}

describe("parser", () => {
  describe("text content", () => {
    const cases = [
      {
        name: "accumulates text deltas",
        lines: [
          "event: response.output_text.delta",
          'data: {"delta":"Hello"}',
          "event: response.output_text.delta",
          'data: {"delta":" world"}',
        ],
        expectedText: "Hello world",
        expectedChunks: ["Hello", " world"],
      },
      {
        name: "ignores unknown event types",
        lines: [
          "event: response.unknown",
          "data: {}",
          "event: response.output_text.delta",
          'data: {"delta":"Hi"}',
        ],
        expectedText: "Hi",
        expectedChunks: ["Hi"],
      },
    ]

    it.each(cases)("$name", ({ lines, expectedText, expectedChunks }) => {
      const ctx = emptyCtx()
      const blocks = flushBlocks(lines, makeCallbacks(ctx))
      const textBlock = blocks.find((b) => b.type === "text")
      expect(textBlock?.type === "text" ? textBlock.content : "").toBe(expectedText)
      expect(ctx.chunks).toEqual(expectedChunks)
    })
  })

  describe("tool calls", () => {
    const cases = [
      {
        name: "parses single tool call",
        lines: [
          "event: response.output_item.done",
          'data: {"item":{"type":"function_call","call_id":"call_1","name":"execute_sql","arguments":"{\\"sql\\":\\"SELECT 1\\"}"}}',
        ],
        expectedCalls: [{ id: "call_1", name: "execute_sql", args: { sql: "SELECT 1" } }],
      },
      {
        name: "fires onToolName on output_item.added",
        lines: [
          "event: response.output_item.added",
          'data: {"item":{"type":"function_call","call_id":"call_1","name":"execute_sql"}}',
        ],
        expectedCalls: [],
        expectedToolNames: ["execute_sql"],
      },
      {
        name: "streams function call arguments delta",
        lines: ["event: response.function_call_arguments.delta", 'data: {"delta":"{\\"sql"}'],
        expectedCalls: [],
        expectedToolArgsChunks: ['{"sql'],
      },
      {
        name: "ignores apply_patch diff delta",
        lines: [
          "event: response.apply_patch_call_operation_diff.delta",
          'data: {"delta":"+hello"}',
        ],
        expectedCalls: [],
        expectedChunks: [],
      },
      {
        name: "streams reasoning summary delta",
        lines: ["event: response.reasoning_summary_text.delta", 'data: {"delta":"Let me think"}'],
        expectedCalls: [],
        expectedReasoningChunks: ["Let me think"],
      },
      {
        name: "parses multiple tool calls",
        lines: [
          "event: response.output_item.done",
          'data: {"item":{"type":"function_call","call_id":"call_1","name":"a","arguments":"{}"}}',
          "event: response.output_item.done",
          'data: {"item":{"type":"function_call","call_id":"call_2","name":"b","arguments":"{}"}}',
        ],
        expectedCalls: [
          { id: "call_1", name: "a", args: {} },
          { id: "call_2", name: "b", args: {} },
        ],
      },
    ]

    it.each(cases)(
      "$name",
      ({
        lines,
        expectedCalls,
        expectedChunks,
        expectedToolArgsChunks,
        expectedReasoningChunks,
        expectedToolNames,
      }) => {
        const ctx = emptyCtx()
        const blocks = flushBlocks(lines, makeCallbacks(ctx))
        const toolBlock = blocks.find((b) => b.type === "tool_call")
        const calls = toolBlock?.type === "tool_call" ? toolBlock.calls : []
        expect(calls).toEqual(expectedCalls)
        if (expectedChunks) expect(ctx.chunks).toEqual(expectedChunks)
        if (expectedToolArgsChunks) expect(ctx.toolArgsChunks).toEqual(expectedToolArgsChunks)
        if (expectedReasoningChunks) expect(ctx.reasoningChunks).toEqual(expectedReasoningChunks)
        if (expectedToolNames) expect(ctx.toolNames).toEqual(expectedToolNames)
      }
    )
  })

  describe("mixed content", () => {
    it("captures both text and tool calls", () => {
      const blocks = flushBlocks([
        "event: response.output_text.delta",
        'data: {"delta":"Let me help"}',
        "event: response.output_item.done",
        'data: {"item":{"type":"function_call","call_id":"call_1","name":"submit_plan","arguments":"{}"}}',
      ])

      const textBlock = blocks.find((b) => b.type === "text")
      const toolBlock = blocks.find((b) => b.type === "tool_call")
      expect(textBlock?.type === "text" ? textBlock.content : "").toBe("Let me help")
      expect(toolBlock?.type === "tool_call" ? toolBlock.calls : []).toEqual([
        { id: "call_1", name: "submit_plan", args: {} },
      ])
    })

    it("captures encrypted reasoning content from output_item.done", () => {
      const blocks = flushBlocks([
        "event: response.reasoning_summary_text.delta",
        'data: {"delta":"Deep thought"}',
        "event: response.output_item.done",
        'data: {"item":{"type":"reasoning","id":"rs_abc","encrypted_content":"gAAAA_encrypted_blob"}}',
        "event: response.output_text.delta",
        'data: {"delta":"Result"}',
      ])

      expect(blocks).toEqual([
        {
          type: "reasoning",
          content: "Deep thought",
          id: "rs_abc",
          encryptedContent: "gAAAA_encrypted_blob",
        },
        { type: "text", content: "Result" },
      ])
    })

    it("captures gemini extra_content reasoning from output_item.done", () => {
      const extraContent = { google: { thought_signature: "dGVzdHNpZw==" } }
      const blocks = flushBlocks([
        "event: response.reasoning_summary_text.delta",
        'data: {"delta":"Gemini thought"}',
        "event: response.output_item.done",
        `data: {"item":{"type":"reasoning","id":"rs_0","extra_content":${JSON.stringify(extraContent)}}}`,
        "event: response.output_text.delta",
        'data: {"delta":"Answer"}',
      ])

      expect(blocks).toEqual([
        {
          type: "reasoning",
          content: "Gemini thought",
          id: "rs_0",
          extraContent,
        },
        { type: "text", content: "Answer" },
      ])
    })

    it("interleaves reasoning and tool calls into separate blocks", () => {
      const blocks = flushBlocks([
        "event: response.reasoning_summary_text.delta",
        'data: {"delta":"First thought"}',
        "event: response.output_item.added",
        'data: {"item":{"type":"function_call","call_id":"call_1","name":"read_file"}}',
        "event: response.output_item.done",
        'data: {"item":{"type":"function_call","call_id":"call_1","name":"read_file","arguments":"{}"}}',
        "event: response.reasoning_summary_text.delta",
        'data: {"delta":"Second thought"}',
        "event: response.output_item.added",
        'data: {"item":{"type":"function_call","call_id":"call_2","name":"write_file"}}',
        "event: response.output_item.done",
        'data: {"item":{"type":"function_call","call_id":"call_2","name":"write_file","arguments":"{}"}}',
      ])

      expect(blocks).toEqual([
        { type: "reasoning", content: "First thought" },
        { type: "tool_call", calls: [{ id: "call_1", name: "read_file", args: {} }] },
        { type: "reasoning", content: "Second thought" },
        { type: "tool_call", calls: [{ id: "call_2", name: "write_file", args: {} }] },
      ])
    })
  })

  describe("error handling", () => {
    it("parses response.failed into error block", () => {
      const blocks = flushBlocks([
        "event: response.output_text.delta",
        'data: {"delta":"partial"}',
        "event: response.failed",
        'data: {"response":{"status":"failed","error":{"type":"SAFETY","message":"output blocked by safety filter"}}}',
      ])

      expect(blocks).toEqual([
        { type: "text", content: "partial" },
        { type: "error", content: "output blocked by safety filter", errorType: "SAFETY" },
      ])
    })

    it("creates error block from response.failed without prior content", () => {
      const blocks = flushBlocks([
        "event: response.failed",
        'data: {"response":{"status":"failed","error":{"type":"stream_error","message":"connection reset"}}}',
      ])

      expect(blocks).toEqual([
        { type: "error", content: "connection reset", errorType: "stream_error" },
      ])
    })

    const errorTypeCases = [
      {
        name: "captures content_filter errorType",
        errorPayload: '{"type":"content_filter","message":"output blocked by content filter"}',
        expectedErrorType: "content_filter",
        expectedMessage: "output blocked by content filter",
      },
      {
        name: "captures RECITATION errorType",
        errorPayload: '{"type":"RECITATION","message":"output blocked by recitation filter"}',
        expectedErrorType: "RECITATION",
        expectedMessage: "output blocked by recitation filter",
      },
      {
        name: "handles missing error type gracefully",
        errorPayload: '{"message":"something went wrong"}',
        expectedErrorType: undefined,
        expectedMessage: "something went wrong",
      },
    ]

    it.each(errorTypeCases)("$name", ({ errorPayload, expectedErrorType, expectedMessage }) => {
      const blocks = flushBlocks([
        "event: response.failed",
        `data: {"response":{"status":"failed","error":${errorPayload}}}`,
      ])

      expect(blocks).toEqual([
        { type: "error", content: expectedMessage, errorType: expectedErrorType },
      ])
    })
  })

  describe("edge cases", () => {
    const cases = [
      {
        name: "handles empty lines",
        lines: ["", "event: response.completed", "data: {}"],
        expectedText: "",
      },
      {
        name: "handles malformed JSON",
        lines: ["event: response.output_text.delta", "data: not json"],
        expectedText: "",
      },
    ]

    it.each(cases)("$name", ({ lines, expectedText }) => {
      const state = processLines(lines)
      expect(state.textContent).toBe(expectedText)
    })
  })
})

describe("blocksToMessages", () => {
  const cases = [
    {
      name: "converts system block to system message",
      blocks: [{ type: "system" as const, content: "You are helpful" }],
      expected: [{ type: "message", role: "system", content: "You are helpful" }],
    },
    {
      name: "converts user block to user message",
      blocks: [{ type: "user" as const, content: "Hi" }],
      expected: [{ type: "message", role: "user", content: "Hi" }],
    },
    {
      name: "converts text block to assistant message",
      blocks: [{ type: "text" as const, content: "Hello" }],
      expected: [{ type: "message", role: "assistant", content: "Hello" }],
    },
    {
      name: "converts tool_call block to function_call items",
      blocks: [
        {
          type: "tool_call" as const,
          calls: [{ id: "1", name: "foo", args: { x: 1 } }],
        },
      ],
      expected: [
        {
          type: "function_call",
          call_id: "1",
          status: "completed",
          name: "foo",
          arguments: '{"x":1}',
        },
      ],
    },
    {
      name: "converts tool_result block to function_call_output",
      blocks: [
        {
          type: "tool_result" as const,
          callId: "1",
          toolName: "execute_sql",
          result: { ok: true },
        },
      ],
      expected: [
        { type: "function_call_output", call_id: "1", status: "completed", output: '{"ok":true}' },
      ],
    },
    {
      name: "converts reasoning with encrypted content to reasoning input item",
      blocks: [
        {
          type: "reasoning" as const,
          content: "thought",
          id: "rs_1",
          encryptedContent: "gAAAA_blob",
        },
      ],
      expected: [
        {
          type: "reasoning",
          id: "rs_1",
          summary: [{ type: "summary_text", text: "thought" }],
          encrypted_content: "gAAAA_blob",
        },
      ],
    },
    {
      name: "skips reasoning without encrypted content or extra content",
      blocks: [{ type: "reasoning" as const, content: "thought" }],
      expected: [],
    },
    {
      name: "converts reasoning with gemini extra_content",
      blocks: [
        {
          type: "reasoning" as const,
          content: "thought",
          id: "rs_0",
          extraContent: { google: { thought_signature: "dGVzdHNpZw==" } },
        },
      ],
      expected: [
        {
          type: "reasoning",
          id: "rs_0",
          extra_content: { google: { thought_signature: "dGVzdHNpZw==" } },
        },
      ],
    },
    {
      name: "skips reasoning without id",
      blocks: [
        {
          type: "reasoning" as const,
          content: "thought",
          extraContent: { google: { thought_signature: "dGVzdHNpZw==" } },
        },
      ],
      expected: [],
    },
    {
      name: "converts mixed blocks in order",
      blocks: [
        { type: "text" as const, content: "Thinking" },
        { type: "tool_call" as const, calls: [{ id: "1", name: "bar", args: {} }] },
        { type: "tool_result" as const, callId: "1", toolName: "bar", result: {} },
      ] as Block[],
      expected: [
        { type: "message", role: "assistant", content: "Thinking" },
        { type: "function_call", call_id: "1", status: "completed", name: "bar", arguments: "{}" },
        { type: "function_call_output", call_id: "1", status: "completed", output: "{}" },
      ],
    },
  ]

  it.each(cases)("$name", ({ blocks, expected }) => {
    expect(blocksToMessages(blocks)).toEqual(expected)
  })
})
