import { describe, expect, it } from "vitest"
import { z } from "zod"
import { commaSeparatedFlag, kindFlag, textFlag } from "./agents/flags"
import { flagsOf, renderFlagLines } from "./flag-help"

const schema = z.object({
  needle: textFlag("<text>", "the text to look for"),
  tags: commaSeparatedFlag("tags to attach").optional(),
  kind: kindFlag,
  bare: z.string().optional(),
})

const statusColumn = (line: string): number => line.search(/ {2}(required|optional) {2}/)

describe("renderFlagLines", () => {
  it("aligns heads and states whether each flag is required", () => {
    const lines = renderFlagLines(flagsOf(schema))
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/^ {2}--needle <text> +required {2}the text to look for$/)
    expect(lines[1]).toMatch(/^ {2}--tags <a,b,…> +optional {2}tags to attach$/)
    expect(lines[3]).toMatch(/^ {2}--bare <value> +optional {2}$/)
    expect(new Set(lines.map(statusColumn))).toHaveProperty("size", 1)
  })

  it("renders nothing for a schema without flags", () => {
    expect(renderFlagLines(flagsOf(z.object({})))).toEqual([])
  })
})
