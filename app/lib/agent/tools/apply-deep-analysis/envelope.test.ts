import { describe, it, expect } from "vitest"
import type { Envelope } from "./envelope"
import { isContestedEnvelope, envelopeText, collectCodeIds } from "./envelope"

const mk = (over: Partial<Envelope> = {}): Envelope => ({
  id: "e1",
  code: "themes",
  file: "f.md",
  fileCharStart: 0,
  fileCharEnd: 10,
  haloSentences: ["x"],
  markedStart: 1,
  markedEnd: 1,
  markedText: "x",
  findVotes: [],
  ...over,
})

describe("isContestedEnvelope", () => {
  it("true when review set", () => {
    expect(isContestedEnvelope(mk({ review: "split" }))).toBe(true)
  })
  it("false when review absent", () => {
    expect(isContestedEnvelope(mk())).toBe(false)
  })
})

describe("envelopeText", () => {
  it("returns markedText", () => {
    expect(envelopeText(mk({ markedText: "hello" }))).toBe("hello")
  })
})

describe("collectCodeIds", () => {
  it("returns unique code set", () => {
    const ids = collectCodeIds([mk({ code: "a" }), mk({ code: "b" }), mk({ code: "a" })])
    expect([...ids].sort()).toEqual(["a", "b"])
  })

  it("empty input → empty set", () => {
    expect(collectCodeIds([]).size).toBe(0)
  })
})
