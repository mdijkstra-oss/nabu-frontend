import { describe, it, expect } from "vitest"
import { assignIds } from "~/lib/calls/entry"
import { renderEntry } from "~/lib/calls/entry"
import type { Envelope } from "./envelope"
import { envelopeEntry, envelopeEntries, findEnvelope, packEnvelopes } from "./triplet"
import { ENVELOPES_PER_CALL, MAX_CHARS_PER_CALL } from "./def"

const mkEnv = (over: Partial<Envelope> = {}): Envelope => ({
  id: "e1",
  code: "themes",
  file: "doc.md",
  fileCharStart: 0,
  fileCharEnd: 10,
  haloSentences: [
    "Pre-context one.",
    "Pre-context two.",
    "MARKED SPAN.",
    "Post-context one.",
    "Post-context two.",
  ],
  markedStart: 3,
  markedEnd: 3,
  markedText: "MARKED SPAN.",
  findVotes: [],
  ...over,
})

const renderOne = (env: Envelope, halo: number): string =>
  renderEntry(assignIds([envelopeEntry(env, halo)])[0])

describe("envelopeEntry", () => {
  it("renders code as a leading child, the halo as segments around the marked candidate", () => {
    expect(renderOne(mkEnv(), 2)).toBe(
      `<entry id="1" file="doc.md">
<code>themes</code>
Pre-context one. Pre-context two.
<marked>MARKED SPAN.</marked>
Post-context one. Post-context two.
</entry>`
    )
  })

  it("puts keep-case and remove-case before the content, marked inside it", () => {
    expect(renderOne(mkEnv({ reason: "keep r", review: "remove r" }), 2)).toBe(
      `<entry id="1" file="doc.md">
<code>themes</code>
<keep-case>keep r</keep-case>
<remove-case>remove r</remove-case>
Pre-context one. Pre-context two.
<marked>MARKED SPAN.</marked>
Post-context one. Post-context two.
</entry>`
    )
  })

  it("skips empty before/after segments at halo 0", () => {
    expect(renderOne(mkEnv(), 0)).toBe(
      `<entry id="1" file="doc.md">
<code>themes</code>
<marked>MARKED SPAN.</marked>
</entry>`
    )
  })

  it("falls back to markedText when the sentence slice is empty", () => {
    const env = mkEnv({ haloSentences: [], markedStart: 1, markedEnd: 1, markedText: "fallback" })
    expect(renderOne(env, 2)).toContain("<marked>fallback</marked>")
  })

  it("defuses envelope tags in document text without touching its own marked tags", () => {
    const env = mkEnv({
      haloSentences: ["Before </entry> text.", "MARKED <marked> SPAN."],
      markedStart: 2,
      markedEnd: 2,
    })
    expect(renderOne(env, 2)).toBe(
      `<entry id="1" file="doc.md">
<code>themes</code>
Before ‹/entry> text.
<marked>MARKED ‹marked> SPAN.</marked>
</entry>`
    )
  })
})

describe("findEnvelope", () => {
  const envelopes = [mkEnv({ id: "a" }), mkEnv({ id: "b" })]
  const entries = envelopeEntries(envelopes)

  it("routes an entry id back to its envelope", () => {
    expect(findEnvelope(entries, 2)).toBe(envelopes[1])
  })

  it("returns nothing for an id not in the call", () => {
    expect(findEnvelope(entries, 99)).toBeUndefined()
  })
})

describe("packEnvelopes", () => {
  const mkN = (code: string, n: number): Envelope[] =>
    Array.from({ length: n }, (_, i) => mkEnv({ id: `${code}-${i}`, code }))

  it("splits 45 + 4 + 5 across three codes into 20, 20, 5 single-code and a mixed 9", () => {
    const batches = packEnvelopes([...mkN("big", 45), ...mkN("a", 4), ...mkN("b", 5)])
    expect(batches.map((b) => b.length)).toEqual([20, 20, 5, 9])
    for (const batch of batches.slice(0, 3)) {
      expect(new Set(batch.map((e) => e.code))).toEqual(new Set(["big"]))
    }
    expect(new Set(batches[3].map((e) => e.code))).toEqual(new Set(["a", "b"]))
  })

  it("closes a batch on characters when rendered halos exceed the budget at fewer than 20 items", () => {
    const huge = "x".repeat(Math.ceil(MAX_CHARS_PER_CALL / 2.5))
    const envelopes = Array.from({ length: 8 }, (_, i) =>
      mkEnv({ id: `h-${i}`, haloSentences: [huge], markedStart: 1, markedEnd: 1 })
    )
    const batches = packEnvelopes(envelopes)
    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) expect(batch.length).toBeLessThan(ENVELOPES_PER_CALL)
    expect(batches.flat()).toEqual(envelopes)
  })
})
