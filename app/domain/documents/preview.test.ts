import { describe, it, expect } from "vitest"
import { previewContent } from "./preview"

const block = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``

describe("previewContent", () => {
  it("returns content unchanged when under the budget", () => {
    const short = "a short document"
    expect(previewContent(short)).toBe(short)
  })

  it("truncates long prose to roughly the budget", () => {
    const long = "x".repeat(6000)
    const out = previewContent(long)
    expect(out.length).toBeLessThan(long.length)
    expect(out.length).toBeLessThanOrEqual(4000)
  })

  it("never cuts in the middle of a block", () => {
    const chart = block("json-chart", "y".repeat(2000))
    const content = "x".repeat(3900) + "\n" + chart + "\n" + "z".repeat(2000)
    const out = previewContent(content)
    // the straddling chart block is excluded whole, not split
    expect(out.includes("```json-chart")).toBe(false)
    expect(out.includes("y".repeat(10))).toBe(false)
  })

  it("re-appends singleton blocks that fall past the cut", () => {
    const attrs = block("json-attributes", '{"tags":["t1"]}')
    const content = "x".repeat(5000) + "\n" + attrs
    const out = previewContent(content)
    expect(out.includes("```json-attributes")).toBe(true)
    expect(out.includes('{"tags":["t1"]}')).toBe(true)
  })

  it("does not duplicate singleton blocks already within the head", () => {
    const attrs = block("json-attributes", '{"tags":["t1"]}')
    const content = attrs + "\n" + "x".repeat(6000)
    const out = previewContent(content)
    expect(out.split("```json-attributes").length - 1).toBe(1)
  })
})
