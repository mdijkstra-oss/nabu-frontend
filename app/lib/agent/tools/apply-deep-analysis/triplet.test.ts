import { describe, it, expect } from "vitest"
import type { Envelope } from "./envelope"
import { renderEnvelopeBlocks } from "./triplet"

const mkEnv = (over: Partial<Envelope> = {}): Envelope => ({
  id: over.id ?? "e1",
  code: over.code ?? "themes",
  file: "doc.md",
  fileCharStart: 0,
  fileCharEnd: 10,
  haloSentences: over.haloSentences ?? [
    "Pre-context one.",
    "Pre-context two.",
    "MARKED SPAN.",
    "Post-context one.",
    "Post-context two.",
  ],
  markedStart: over.markedStart ?? 3,
  markedEnd: over.markedEnd ?? 3,
  markedText: over.markedText ?? "MARKED SPAN.",
  findVotes: [],
  reason: over.reason,
  review: over.review,
})

describe("renderEnvelopeBlocks", () => {
  it("emits one block per envelope with sequential index", () => {
    const { blocks, mapping } = renderEnvelopeBlocks([mkEnv({ id: "a" }), mkEnv({ id: "b" })], 2)
    expect(blocks.length).toBe(2)
    expect(mapping.map((m) => m.index)).toEqual([1, 2])
    expect(mapping.map((m) => m.envelopeId)).toEqual(["a", "b"])
  })

  it("block includes target header with code", () => {
    const { blocks } = renderEnvelopeBlocks([mkEnv({ code: "abc" })], 2)
    expect(blocks[0]).toContain(`<target id="1" code="abc">`)
  })

  it("block contains <marked> wrapping candidate text", () => {
    const { blocks } = renderEnvelopeBlocks([mkEnv()], 2)
    expect(blocks[0]).toContain("<marked>MARKED SPAN.</marked>")
  })

  it("includes before/after halo within bounds", () => {
    const { blocks } = renderEnvelopeBlocks([mkEnv()], 2)
    expect(blocks[0]).toContain("Pre-context one. Pre-context two.")
    expect(blocks[0]).toContain("Post-context one. Post-context two.")
  })

  it("halo size 0 omits before/after", () => {
    const { blocks } = renderEnvelopeBlocks([mkEnv()], 0)
    expect(blocks[0]).not.toContain("Pre-context")
    expect(blocks[0]).not.toContain("Post-context")
  })

  it("includes keep-case / remove-case when reason/review set", () => {
    const env = mkEnv({ reason: "keep r", review: "remove r" })
    const { blocks } = renderEnvelopeBlocks([env], 2)
    expect(blocks[0]).toContain("<keep-case>keep r</keep-case>")
    expect(blocks[0]).toContain("<remove-case>remove r</remove-case>")
  })

  it("falls back to markedText when sentences slice is empty", () => {
    const env = mkEnv({ haloSentences: [], markedStart: 1, markedEnd: 1, markedText: "fallback" })
    const { blocks } = renderEnvelopeBlocks([env], 2)
    expect(blocks[0]).toContain("<marked>fallback</marked>")
  })
})
