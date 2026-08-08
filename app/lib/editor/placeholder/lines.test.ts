import { describe, it, expect } from "vitest"
import { PLACEHOLDER_LINES, pickPlaceholderLine } from "./lines"

describe("pickPlaceholderLine", () => {
  it("draws from the pool", () => {
    expect(PLACEHOLDER_LINES).toContain(pickPlaceholderLine())
  })

  it("maps the random range onto the full pool", () => {
    expect(pickPlaceholderLine(() => 0)).toBe(PLACEHOLDER_LINES[0])
    expect(pickPlaceholderLine(() => 0.999999)).toBe(
      PLACEHOLDER_LINES[PLACEHOLDER_LINES.length - 1]
    )
  })

  it("offers enough distinct lines", () => {
    expect(PLACEHOLDER_LINES.length).toBeGreaterThanOrEqual(15)
    expect(new Set(PLACEHOLDER_LINES).size).toBe(PLACEHOLDER_LINES.length)
  })
})
