import { describe, it, expect } from "vitest"
import { hashSentences } from "./units"

describe("hashSentences", () => {
  it("separates the sentences it joins, so a moved boundary is a different run", () => {
    expect(hashSentences(["Yeah", "."])).not.toBe(hashSentences(["Yeah."]))
  })
})
