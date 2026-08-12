import { describe, it, expect } from "vitest"
import { assignIds } from "~/lib/calls/entry"
import { buildScoutFilterMessages } from "./messages"

const textOf = (content: string | { text: string }[]): string =>
  typeof content === "string" ? content : content.map((part) => part.text).join("")

describe("buildScoutFilterMessages", () => {
  const entries = assignIds([
    { item: null, file: "a.md", content: { plain: ["First."] } },
    { item: null, file: "b.md", content: { plain: ["Second."] } },
  ])

  it("renders framework as stable preamble, one entry per message, CTA as final user message", () => {
    const messages = buildScoutFilterMessages("The framework.", entries)

    expect(messages).toHaveLength(4)
    expect(messages[0].role).toBe("system")
    expect(textOf(messages[0].content)).toBe("The framework.")
    expect(messages[1].role).toBe("system")
    expect(textOf(messages[1].content)).toContain('<entry id="1" file="a.md">')
    expect(textOf(messages[1].content)).toContain("First.")
    expect(textOf(messages[2].content)).toContain('<entry id="2" file="b.md">')
    expect(textOf(messages[2].content)).toContain("Second.")
    expect(messages[3].role).toBe("user")
  })

  it("marks the cache breakpoint on the framework message", () => {
    const messages = buildScoutFilterMessages("The framework.", entries)

    const content = messages[0].content
    if (typeof content === "string") throw new Error("expected breakpoint-marked content parts")
    expect(content[content.length - 1].prompt_cache_breakpoint).toEqual({ mode: "explicit" })
  })
})
