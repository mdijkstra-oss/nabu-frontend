import { describe, expect, it } from "vitest"
import type { Block } from "../client/blocks"
import { rejectUnavailableTools } from "./modes"

const toolCall = (names: string[]): Block => ({
  type: "tool_call",
  calls: names.map((name, i) => ({ id: `c${i}`, name, args: {} })),
})

const textBlock = (content: string): Block => ({ type: "text", content })

describe("rejectUnavailableTools", () => {
  const reject = rejectUnavailableTools("exec")

  const cases = [
    {
      name: "passes through non-tool-call blocks",
      blocks: [textBlock("hello")],
      check: (result: Block[]) => {
        expect(result).toEqual([textBlock("hello")])
      },
    },
    {
      name: "keeps tool calls available in mode",
      blocks: [toolCall(["complete_step"])],
      check: (result: Block[]) => {
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe("tool_call")
      },
    },
    {
      name: "replaces fully unavailable tool call with system redirect",
      blocks: [toolCall(["start_planning"])],
      check: (result: Block[]) => {
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe("system")
        expect((result[0] as { content: string }).content).toContain("start_planning")
        expect((result[0] as { content: string }).content).toContain("exec")
      },
    },
    {
      name: "splits mixed tool call: keeps valid, rejects invalid",
      blocks: [toolCall(["apply_deep_analysis", "start_planning"])],
      check: (result: Block[]) => {
        expect(result).toHaveLength(2)
        expect(result[0].type).toBe("tool_call")
        const calls = (result[0] as { calls: { name: string }[] }).calls
        expect(calls).toHaveLength(1)
        expect(calls[0].name).toBe("apply_deep_analysis")
        expect(result[1].type).toBe("system")
      },
    },
    {
      name: "cancel is always available",
      blocks: [toolCall(["cancel"])],
      check: (result: Block[]) => {
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe("tool_call")
      },
    },
  ]

  it.each(cases)("$name", ({ blocks, check }) => check(reject(blocks)))
})
