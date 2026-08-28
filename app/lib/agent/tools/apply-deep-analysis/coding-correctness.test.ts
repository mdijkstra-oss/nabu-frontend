import { describe, expect, it } from "vitest"
import { respondingWith, textOf } from "~/lib/calls/parse.fixture"
import { buildCodingChunks } from "./coding-chunk"
import { runCoders, type CoderSelection, type CodingCandidate } from "./step-code"
import { adjudicateContestedSelections } from "./step-adjudicate"
import type { ScopedSources } from "./messages"

// Adversarial suite for the coding caller. Each test pins a behaviour that only
// exists here; the ref grammar, entry rendering and packing budgets themselves
// are pinned at the composer layer in lib/calls.

const document = "First sentence. Second sentence. Third sentence."
const chunk = buildCodingChunks([{ path: "doc.md" }], () => document)[0]

const candidateFor = (code: string): CodingCandidate => ({
  code,
  dimensionPath: `${code}.generated.hidden.md`,
  chunk,
})

const callout = (id: string, title: string, content: string): string =>
  [
    "```json-callout",
    JSON.stringify({ id, type: "codebook-code", title, content, color: "blue", collapsed: false }),
    "```",
  ].join("\n")

const sources: ScopedSources = { framework: [], dimension: ["codes.md"] }
const resolve = (path: string): string | undefined =>
  path === "codes.md"
    ? [
        callout("themes", "Themes", "Themes definition"),
        callout("other", "Other", "Other definition"),
      ].join("\n\n")
    : "Code definition"

const selectionFor = (code: string): CoderSelection => ({
  candidate: candidateFor(code),
  coder: "voter-one",
  start: 1,
  end: 1,
  reason: `${code} reason`,
})

describe("coder answers", () => {
  it("counts one coder's repeated answer for the same span once", async () => {
    const { parse } = respondingWith(() => ({
      results: [
        { code: "themes", start: "1.1", end: "1.1", reason: "first" },
        { code: "themes", start: "1.1", end: "1.1", reason: "again" },
      ],
    }))

    const result = await runCoders([candidateFor("themes")], ["voter-one"], sources, resolve, parse)

    expect(result.errors).toEqual([])
    expect(result.selections.get("voter-one")).toHaveLength(1)
  })

  it("drops a selection whose code is not the code of the chunk it points at", async () => {
    const { parse } = respondingWith(() => ({
      results: [
        { code: "themes", start: "1.1", end: "1.1", reason: "themes" },
        { code: "other", start: "1.1", end: "1.1", reason: "other" },
      ],
    }))

    const result = await runCoders(
      [candidateFor("themes"), candidateFor("other")],
      ["voter-one"],
      sources,
      resolve,
      parse
    )

    // Both answers name entry 1, but entry 1 carries exactly one of the two codes.
    expect(result.selections.get("voter-one")).toHaveLength(1)
  })

  it("rejects a code outside the batch's own codes at the schema, leaving the call unanswered", async () => {
    const { parse } = respondingWith(() => ({
      results: [{ code: "other", start: "1.1", end: "1.1", reason: "off-batch code" }],
    }))

    const result = await runCoders([candidateFor("themes")], ["voter-one"], sources, resolve, parse)

    expect(result.selections.get("voter-one")).toEqual([])
    expect(result.errors).toHaveLength(1)
  })

  it("carries only the batch's own code sources", async () => {
    const { parse, calls } = respondingWith(() => ({ results: [] }))

    await runCoders([candidateFor("themes")], ["voter-one"], sources, resolve, parse)

    const sent = calls[0].messages.map(textOf).join("\n")
    expect(sent).toContain("Themes definition")
    expect(sent).not.toContain("Other definition")
  })
})

describe("adjudication verdicts", () => {
  it("rejects a code outside the batch's own codes at the schema", async () => {
    const { parse } = respondingWith(() => ({
      results: [{ id: 1, code: "other", judgment: "keep", reason: "off-batch code" }],
    }))

    const result = await adjudicateContestedSelections(
      [selectionFor("themes")],
      sources,
      resolve,
      parse
    )

    expect(result.accepted).toEqual([])
    expect(result.errors).toHaveLength(1)
  })

  it("matches a verdict to the entry whose own code it names", async () => {
    const { parse } = respondingWith(() => ({
      results: [
        { id: 1, code: "themes", judgment: "keep", reason: "one" },
        { id: 2, code: "themes", judgment: "keep", reason: "two" },
      ],
    }))

    const result = await adjudicateContestedSelections(
      [selectionFor("themes"), selectionFor("other")],
      sources,
      resolve,
      parse
    )

    // Only one of the two entries is the themes entry; the other verdict is ignored
    // rather than cross-assigned, so its selection goes unjudged.
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0].candidate.code).toBe("themes")
    expect(result.errors).toHaveLength(1)
  })
})
