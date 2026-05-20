import { describe, expect, it } from "vitest"
import { checkToolAvailability } from "./modes"

describe("checkToolAvailability", () => {
  const cases = [
    {
      name: "available tool returns null",
      tool: "complete_step",
      mode: "exec" as const,
      expected: null,
    },
    {
      name: "cancel is always available",
      tool: "cancel",
      mode: "plan" as const,
      expected: null,
    },
    {
      name: "known tool in wrong mode returns mode error",
      tool: "start_planning",
      mode: "exec" as const,
      check: (result: string | null) => {
        expect(result).toContain("start_planning")
        expect(result).toContain("not available in exec mode")
      },
    },
    {
      name: "unknown tool returns list of available tools",
      tool: "read_file",
      mode: "exec" as const,
      check: (result: string | null) => {
        expect(result).toContain("does not exist")
        expect(result).toContain("Available tools:")
      },
    },
  ]

  it.each(cases)("$name", ({ tool, mode, expected, check }) => {
    const result = checkToolAvailability(tool, mode)
    if (check) {
      check(result)
    } else {
      expect(result).toBe(expected)
    }
  })
})
