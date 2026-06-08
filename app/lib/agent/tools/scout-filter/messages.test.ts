import { describe, it, expect } from "vitest"
import { buildScoutFilterMessages, type NumberedEntry } from "./messages"

describe("buildScoutFilterMessages", () => {
  const entries: NumberedEntry[] = [
    { index: 1, text: "First." },
    { index: 2, text: "Second." },
  ]

  it("produces framework + numbered entries + CTA", () => {
    const messages = buildScoutFilterMessages("The framework.", entries)

    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({
      type: "message",
      role: "system",
      content: "The framework.",
    })
    expect(messages[1].content).toContain('<entry id="1">')
    expect(messages[1].content).toContain("First.")
    expect(messages[1].content).toContain('<entry id="2">')
    expect(messages[1].content).toContain("Second.")
    expect(messages[2].role).toBe("user")
  })

  it("omits framework message when framework is empty", () => {
    const messages = buildScoutFilterMessages("", entries)

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe("system")
    expect(messages[0].content).toContain('<entry id="1">')
    expect(messages[1].role).toBe("user")
  })
})
