import { describe, it, expect } from "vitest"
import type { Envelope } from "./envelope"
import { filterEnvelopes } from "./step-filter"
import { adjudicateEnvelopes } from "./step-adjudicate"
import { buildAdjudicateSchema, type ContentResolver, type ScopedSources } from "./messages"
import { envelopeEntry, packEnvelopes } from "./triplet"
import { assignIds, renderEntry } from "~/lib/calls/entry"
import { renderedEntriesIn, respondingWith, textOf } from "./parse-call.fixture"
import { ENVELOPES_PER_CALL, MAX_CHARS_PER_CALL } from "./def"

// Adversarial correctness suite for the deep-analysis caller component
// (docs/specs/2026-08-12-04-batched-model-calls/deep-analysis.md). Each test
// pins a behavior the review hunted; the first two suites guard fixes that
// closed review findings.

const mkEnv = (id: string, over: Partial<Envelope> = {}): Envelope => ({
  id,
  code: "themes",
  file: "doc.md",
  fileCharStart: 0,
  fileCharEnd: 10,
  haloSentences: [`SPAN ${id}.`],
  markedStart: 1,
  markedEnd: 1,
  markedText: `SPAN ${id}.`,
  findVotes: [],
  ...over,
})

const noSources: ScopedSources = { framework: [], dimension: [] }
const noFiles: ContentResolver = () => undefined

const judgment = (id: number, judgment: "keep" | "remove", reason: string, code = "themes") => ({
  id,
  code,
  judgment,
  reason,
})

describe("filter stats count a voter's repeated id once", () => {
  // step-filter.ts builds `judgments` (a Map keyed by envelope id, last-write-wins —
  // the semantics used everywhere else, including buildVoteList/mergeVotes) but
  // accumulates `stats` in the SAME loop by summing every occurrence of a "keep"
  // result, not the id's final judgment. A voter that answers the same id twice
  // inflates stats by more than the one vote that actually reaches consensus.
  it("counts one voter's keep vote for one envelope only once, even if the voter answers the id twice", async () => {
    const envelopes = [mkEnv("a")]
    const { parse } = respondingWith((endpoint) =>
      endpoint.endsWith("voter-one")
        ? { results: [judgment(1, "keep", "first"), judgment(1, "keep", "again")] }
        : { results: [judgment(1, "keep", "solid")] }
    )

    const result = await filterEnvelopes(envelopes, noSources, noFiles, undefined, parse)

    // One envelope, one vote per voter: each voter contributes at most one keep.
    expect(result.stats.get("themes")).toEqual([1, 1])
  })

  it("stats never exceed the envelope count contributed by a single voter's distinct votes", async () => {
    const envelopes = [mkEnv("a"), mkEnv("b")]
    const { parse } = respondingWith((endpoint) =>
      endpoint.endsWith("voter-one")
        ? {
            results: [
              judgment(1, "keep", "x"),
              judgment(1, "keep", "x again"),
              judgment(2, "keep", "y"),
            ],
          }
        : { results: [judgment(1, "keep", "z"), judgment(2, "keep", "w")] }
    )

    const result = await filterEnvelopes(envelopes, noSources, noFiles, undefined, parse)

    // Two envelopes, both kept by both voters — m0 and m1 should each be 2.
    expect(result.stats.get("themes")).toEqual([2, 2])
  })
})

describe("filter stats bucket by the envelope's own code", () => {
  it("attributes a keep vote to the envelope's own code, not a schema-valid but mismatched code the model reported", async () => {
    // A mixed batch, so both "themes" and "other" are valid entries in the
    // schema's code enum. The model correctly identifies id 1 (judgment: keep)
    // but mislabels which code it belongs to.
    const envelopes = [mkEnv("a", { code: "themes" }), mkEnv("b", { code: "other" })]
    const { parse } = respondingWith(() => ({
      results: [judgment(1, "keep", "fits", "other"), judgment(2, "keep", "fits2", "other")],
    }))

    const result = await filterEnvelopes(envelopes, noSources, noFiles, undefined, parse)

    // Envelope "a" is coded "themes"; a keep vote on it should count toward
    // "themes" stats regardless of what code string the model echoed back.
    expect(result.stats.get("themes")).toEqual([1, 1])
  })
})

describe("PIN — per-batch code scoping (deep-analysis.md line 21): a single-code batch's schema rejects another batch's code", () => {
  const mkContested = (n: number, code: string): Envelope => ({
    id: `${code}-${n}`,
    code,
    file: "doc.md",
    fileCharStart: 0,
    fileCharEnd: 10,
    haloSentences: [`SPAN ${code}-${n}.`],
    markedStart: 1,
    markedEnd: 1,
    markedText: `SPAN ${code}-${n}.`,
    findVotes: [],
    reason: "kept because",
    review: "split",
  })

  it("a batch made entirely of code A cannot be answered with code B — the call is classified unanswered", async () => {
    // 25 contested envelopes of code "A" force packEnvelopes to keep A's
    // batches single-code (a group >= maxItems fills its own batches,
    // remainder included) — per packing.md's groupKey semantics.
    const codeA = Array.from({ length: 25 }, (_, n) => mkContested(n, "A"))
    const codeB = [mkContested(0, "B")]

    const seenCodesPerCall: string[][] = []
    const { parse } = respondingWith((_endpoint, messages) => {
      const entries = renderedEntriesIn(messages)
      const codes = messages
        .map(textOf)
        .join("\n")
        .match(/<code>(\w+)<\/code>/g)
      seenCodesPerCall.push([...new Set((codes ?? []).map((c) => c.replace(/<\/?code>/g, "")))])
      // Every call answers its own first entry with the OTHER batch's code —
      // schema-invalid whenever the batch is single-code.
      const foreignCode = entries.length > 0 && seenCodesPerCall.at(-1)?.includes("A") ? "B" : "A"
      return {
        results: entries.map((e) => ({
          id: e.id,
          code: foreignCode,
          judgment: "keep",
          reason: "x",
        })),
      }
    })

    const result = await adjudicateEnvelopes(
      [...codeA, ...codeB],
      noSources,
      noFiles,
      undefined,
      parse
    )

    // Every single-code-A batch's schema rejected the foreign "B" code, so the
    // call fails to parse and its envelopes are recorded as errored/ambiguous —
    // never silently accepted under a code that batch never carried.
    expect(result.errors.length).toBeGreaterThan(0)
    expect(seenCodesPerCall.some((codes) => codes.length === 1 && codes[0] === "A")).toBe(true)
  })

  it("buildAdjudicateSchema's code enum is exactly the batch's own codes", () => {
    const schema = buildAdjudicateSchema(["A"])
    const parsed = schema.safeParse({
      results: [{ id: 1, code: "B", judgment: "keep", reason: "x" }],
    })
    expect(parsed.success).toBe(false)
  })
})

describe("PIN — per-batch code-source message scoping: a batch's sources exclude other batches' code content", () => {
  it("an adjudication call over code A never carries code B's source content", async () => {
    const codeA = Array.from({ length: 25 }, (_, n) => ({
      id: `A-${n}`,
      code: "A",
      file: "doc.md",
      fileCharStart: 0,
      fileCharEnd: 10,
      haloSentences: [`SPAN A-${n}.`],
      markedStart: 1,
      markedEnd: 1,
      markedText: `SPAN A-${n}.`,
      findVotes: [],
      reason: "kept",
      review: "split",
    }))
    const codeB = [
      {
        id: "B-0",
        code: "B",
        file: "doc.md",
        fileCharStart: 0,
        fileCharEnd: 10,
        haloSentences: ["SPAN B-0."],
        markedStart: 1,
        markedEnd: 1,
        markedText: "SPAN B-0.",
        findVotes: [],
        reason: "kept",
        review: "split",
      },
    ]

    const files: Record<string, string> = {
      "dim.md": [codeblock("A", "SOURCE-MARKER-FOR-A"), codeblock("B", "SOURCE-MARKER-FOR-B")].join(
        "\n"
      ),
    }
    const sources: ScopedSources = { framework: [], dimension: ["dim.md"] }
    const { parse, calls } = respondingWith(() => ({ results: [] }))

    await adjudicateEnvelopes([...codeA, ...codeB], sources, (p) => files[p], undefined, parse)

    const singleCodeACalls = calls.filter((c) =>
      c.messages.some(
        (m) => textOf(m).includes("<code>A</code>") && !textOf(m).includes("<code>B</code>")
      )
    )
    expect(singleCodeACalls.length).toBeGreaterThan(0)
    for (const call of singleCodeACalls) {
      const all = call.messages.map(textOf).join("\n")
      expect(all).toContain("SOURCE-MARKER-FOR-A")
      expect(all).not.toContain("SOURCE-MARKER-FOR-B")
    }
  })
})

const codeblock = (id: string, marker: string): string =>
  [
    "```json-callout",
    JSON.stringify({
      id,
      type: "codebook-code",
      title: id,
      content: marker,
      color: "blue",
      collapsed: false,
    }),
    "```",
  ].join("\n")

describe("PIN — rendering: filter entries never carry keep-case/remove-case (deep-analysis.md line 11)", () => {
  it("a freshly-found (unreasoned) envelope's filter payload has no keep-case or remove-case child", async () => {
    const envelopes = [mkEnv("a")]
    const { parse, calls } = respondingWith(() => ({ results: [] }))

    await filterEnvelopes(envelopes, noSources, noFiles, undefined, parse)

    const rendered = textOf(calls[0].messages[1])
    expect(rendered).not.toContain("<keep-case>")
    expect(rendered).not.toContain("<remove-case>")
  })
})

describe("PIN — rendering: code child always precedes keep-case/remove-case, marked sits inside content (deep-analysis.md line 11)", () => {
  it("children render in the fixed order code, keep-case, remove-case, ahead of the marked content", () => {
    const env = mkEnv("a", { reason: "keep r", review: "remove r" })
    const rendered = renderEntry(assignIds([envelopeEntry(env, 2)])[0])
    const codeIdx = rendered.indexOf("<code>")
    const keepIdx = rendered.indexOf("<keep-case>")
    const removeIdx = rendered.indexOf("<remove-case>")
    const markedIdx = rendered.indexOf("<marked>")
    expect(codeIdx).toBeGreaterThanOrEqual(0)
    expect(codeIdx).toBeLessThan(keepIdx)
    expect(keepIdx).toBeLessThan(removeIdx)
    expect(removeIdx).toBeLessThan(markedIdx)
  })
})

describe("PIN — rendering: a literal <code> in document text is defused through the composer (envelope.md line 31)", () => {
  it("markedText containing a literal <code> tag is defused rather than rendering a forged child element", () => {
    const env = mkEnv("a", {
      haloSentences: ["Before text.", "It says <code>oops</code> right there."],
      markedStart: 2,
      markedEnd: 2,
    })
    const rendered = renderEntry(assignIds([envelopeEntry(env, 2)])[0])
    // Exactly one real <code> element: the composer's own child.
    expect(rendered.match(/(?<!‹)<code>/g)?.length).toBe(1)
    expect(rendered).toContain("‹code>oops‹/code>")
  })
})

describe("PIN — rendering: empty halo at the document boundary (deep-analysis.md, halo semantics)", () => {
  it("markedStart 1 renders no leading segment even with sentences available and halo > 0", () => {
    const env = mkEnv("a", {
      haloSentences: ["MARKED SPAN.", "Trailing one.", "Trailing two."],
      markedStart: 1,
      markedEnd: 1,
    })
    const rendered = renderEntry(assignIds([envelopeEntry(env, 6)])[0])
    expect(rendered).toBe(
      `<entry id="1" file="doc.md">
<code>themes</code>
<marked>MARKED SPAN.</marked>
Trailing one. Trailing two.
</entry>`
    )
  })

  it("markedEnd at the last sentence renders no trailing segment even with sentences available and halo > 0", () => {
    const env = mkEnv("a", {
      haloSentences: ["Leading one.", "Leading two.", "MARKED SPAN."],
      markedStart: 3,
      markedEnd: 3,
    })
    const rendered = renderEntry(assignIds([envelopeEntry(env, 6)])[0])
    expect(rendered).toBe(
      `<entry id="1" file="doc.md">
<code>themes</code>
Leading one. Leading two.
<marked>MARKED SPAN.</marked>
</entry>`
    )
  })
})

describe("PIN — packing: sizeOf is measured on the rendered entry, including adjudication children (packing.md line 9)", () => {
  it("an envelope with a huge keep-case is counted at its rendered size, closing the batch earlier", () => {
    const hugeReason = "k".repeat(Math.floor(MAX_CHARS_PER_CALL * 0.6))
    const envelopes = [
      mkEnv("a", { reason: hugeReason, review: "small" }),
      mkEnv("b", { reason: hugeReason, review: "small" }),
    ]
    const batches = packEnvelopes(envelopes)
    // Two envelopes whose keep-case alone is 60% of the budget each cannot
    // share a batch; if sizeOf ignored children, they'd pack together.
    expect(batches.length).toBe(2)
  })

  it("the same envelope's tiny halo alone (no children) would fit in one batch — isolating the children's contribution", () => {
    const envelopes = [mkEnv("a"), mkEnv("b")]
    const batches = packEnvelopes(envelopes)
    expect(batches.length).toBe(1)
  })
})

describe("PIN — packing: the 40k budget closes adjudication batches on characters, not just the item cap (packing.md line 26)", () => {
  it("fewer than ENVELOPES_PER_CALL contested envelopes still split when their rendered size exceeds the budget", async () => {
    const huge = "x".repeat(Math.ceil(MAX_CHARS_PER_CALL / 2.5))
    const contested = Array.from({ length: 8 }, (_, n) => ({
      id: `c${n}`,
      code: "themes",
      file: "doc.md",
      fileCharStart: 0,
      fileCharEnd: 10,
      haloSentences: [huge],
      markedStart: 1,
      markedEnd: 1,
      markedText: `SPAN ${n}.`,
      findVotes: [],
      reason: "kept",
      review: "split",
    }))
    const { parse, calls } = respondingWith((_endpoint, messages) => ({
      results: renderedEntriesIn(messages).map((e) => ({
        id: e.id,
        code: "themes",
        judgment: "keep",
        reason: "x",
      })),
    }))

    await adjudicateEnvelopes(contested, noSources, noFiles, undefined, parse)

    expect(calls.length).toBeGreaterThan(1)
    for (const call of calls) expect(call.messages.length).toBeLessThan(ENVELOPES_PER_CALL + 2)
  })
})

describe("PIN — silence: an envelope no voter mentions (but both calls succeed) survives, per buildVoteList semantics (deep-analysis.md line 25)", () => {
  it("an id absent from both voters' answered results survives untouched, distinctly from a call failure", async () => {
    const envelopes = [mkEnv("a"), mkEnv("silent")]
    const { parse } = respondingWith(() => ({
      // Neither voter's (successful) call mentions id 2 ("silent").
      results: [judgment(1, "keep", "fits")],
    }))

    const result = await filterEnvelopes(envelopes, noSources, noFiles, undefined, parse)

    expect(result.errors).toEqual([])
    expect(result.surviving.map((e) => e.id).sort()).toEqual(["a", "silent"])
    expect(result.surviving.find((e) => e.id === "silent")?.reason).toBeUndefined()
  })
})

describe("PIN — batch isolation: numeric ids are call-local, resolved only against their own batch's entries", () => {
  it("id 1 in two different batches' entries resolves to each batch's own first envelope, never the other's", () => {
    const envA = mkEnv("a")
    const envB = mkEnv("b")
    const entriesA = assignIds([envelopeEntry(envA, 2)])
    const entriesB = assignIds([envelopeEntry(envB, 2)])

    expect(entriesA[0].id).toBe(1)
    expect(entriesB[0].id).toBe(1)
    expect(entriesA[0].item).toBe(envA)
    expect(entriesB[0].item).toBe(envB)
    expect(entriesA[0].item).not.toBe(entriesB[0].item)
  })

  it("adjudication verdicts route by the envelope's stable id, not the batch-local numeric id, so a 20/5 split of one code never cross-assigns a verdict", async () => {
    // 25 contested envelopes of the same code force two batches (20, 5); both
    // batches' entries restart numeric ids at 1. The 21st original envelope
    // is entry id 1 of the SECOND batch — verify its verdict lands on it
    // specifically, not on the first envelope of the first batch.
    const mk = (n: number) => ({
      id: `c${n}`,
      code: "themes",
      file: "doc.md",
      fileCharStart: 0,
      fileCharEnd: 10,
      haloSentences: [`SPAN ${n}.`],
      markedStart: 1,
      markedEnd: 1,
      markedText: `SPAN ${n}.`,
      findVotes: [],
      reason: "kept",
      review: "split",
    })
    const contested = Array.from({ length: 25 }, (_, n) => mk(n))

    const { parse } = respondingWith((_endpoint, messages) => {
      const entries = renderedEntriesIn(messages)
      // Reject only the batch-local entry id 1, in every batch.
      return {
        results: entries
          .filter((e) => e.id === 1)
          .map((e) => ({ id: e.id, code: "themes", judgment: "reject", reason: "x" })),
      }
    })

    const result = await adjudicateEnvelopes(contested, noSources, noFiles, undefined, parse)

    const survivingIds = new Set(result.envelopes.map((e) => e.id))
    // Exactly two envelopes rejected — the first item of each batch (c0 and
    // c20, since the 20-item batch takes c0..c19 and the 5-item batch takes
    // c20..c24) — never a third, and never one from the wrong batch.
    expect(survivingIds.has("c0")).toBe(false)
    expect(survivingIds.has("c20")).toBe(false)
    expect(result.envelopes.length).toBe(23)
  })
})
