import { describe, expect, it } from "vitest"
import type { Block } from "./blocks"
import { extractSchemaResponse } from "./call-parse"

describe("extractSchemaResponse", () => {
  const cases: { name: string; blocks: Block[]; expected: string }[] = [
    {
      name: "uses an ordinary text response",
      blocks: [
        { type: "text", content: '{"results":["from text"]}' },
        {
          type: "tool_call",
          calls: [{ id: "call-1", name: "StructuredOutput", args: { results: ["from tool"] } }],
        },
      ],
      expected: '{"results":["from text"]}',
    },
    {
      name: "uses the final structured output tool call",
      blocks: [
        {
          type: "tool_call",
          calls: [
            { id: "call-1", name: "StructuredOutput", args: { results: ["draft"] } },
            { id: "call-2", name: "StructuredOutput", args: { results: ["final"] } },
          ],
        },
      ],
      expected: '{"results":["final"]}',
    },
    {
      name: "ignores unrelated tool calls",
      blocks: [
        {
          type: "tool_call",
          calls: [{ id: "call-1", name: "execute_sql", args: { sql: "SELECT 1" } }],
        },
      ],
      expected: "",
    },
    {
      name: "returns empty when there is no schema response",
      blocks: [{ type: "reasoning", content: "Thinking" }],
      expected: "",
    },
  ]

  it.each(cases)("$name", ({ blocks, expected }) => {
    expect(extractSchemaResponse(blocks)).toBe(expected)
  })
})
