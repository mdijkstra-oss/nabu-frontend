import { describe, expect, it } from "vitest"
import { respondingWith, textOf } from "~/lib/calls/parse.fixture"
import { buildCodingChunks } from "./coding-chunk"
import { runCoders, type CoderSelection, type CodingCandidate } from "./step-code"
import { adjudicateContestedSelections } from "./step-adjudicate"
import type { ScopedSources } from "./messages"
import { CHUNKS_PER_CALL, MAX_CODES_PER_CALL } from "./def"

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
        callout("themes", "Themes", "THEMES-DEFINITION"),
        callout("other", "Other", "OTHER-DEFINITION"),
        callout("third", "Third", "THIRD-DEFINITION"),
        callout("fourth", "Fourth", "FOURTH-DEFINITION"),
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

  it("accepts different active codes addressed to the same shared chunk entry", async () => {
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

    expect(
      result.selections.get("voter-one")?.map((selection) => selection.candidate.code)
    ).toEqual(["themes", "other"])
  })

  it("rejects a code outside the batch's own codes at the schema, leaving the call unanswered", async () => {
    const { parse } = respondingWith(() => ({
      results: [{ code: "other", start: "1.1", end: "1.1", reason: "off-batch code" }],
    }))

    const result = await runCoders([candidateFor("themes")], ["voter-one"], sources, resolve, parse)

    expect(result.selections.get("voter-one")).toEqual([])
    expect(result.errors).toHaveLength(1)
  })

  it("carries every active code source once while rendering the chunk once", async () => {
    const { parse, calls } = respondingWith(() => ({ results: [] }))

    await runCoders(
      [candidateFor("themes"), candidateFor("other")],
      ["voter-one"],
      sources,
      resolve,
      parse
    )

    const sent = calls[0].messages.map(textOf).join("\n")
    expect(sent).toContain("THEMES-DEFINITION")
    expect(sent).toContain("OTHER-DEFINITION")
    expect(sent.match(/\[1\.1\] First sentence\./g)).toHaveLength(1)
    expect(sent).not.toContain("<code>")
    expect(sent).not.toContain("<codes>")
  })

  it("crosses bounded code batches with cross-file chunk batches", async () => {
    const codes = ["themes", "other", "third", "fourth"]
    const chunks = Array.from({ length: CHUNKS_PER_CALL + 1 }, (_, index) => ({
      ...chunk,
      id: `chunk-${index}`,
      file: index % 2 === 0 ? "alpha.md" : "beta.md",
      hash: `hash-${index}`,
      text: `Chunk ${index}.`,
      sentences: [{ ...chunk.sentences[0], text: `Chunk ${index}.` }],
    }))
    const candidates = codes.flatMap((code) =>
      chunks.map((chunk) => ({ ...candidateFor(code), chunk }))
    )
    const { parse, calls } = respondingWith(() => ({ results: [] }))

    await runCoders(candidates, ["voter-one"], sources, resolve, parse)

    expect(calls).toHaveLength(4)
    expect(
      calls.map((call) => {
        const sent = call.messages.map(textOf).join("\n")
        const chunkNumbers = [...sent.matchAll(/\[\d+\.1\] Chunk (\d+)\./g)].map(
          (match) => match[1]
        )
        return {
          entries: sent.match(/<entry id=/g)?.length,
          uniqueChunks: new Set(chunkNumbers).size,
          files: ["alpha.md", "beta.md"].filter((file) => sent.includes(`file="${file}"`)),
          definitions: [
            "THEMES-DEFINITION",
            "OTHER-DEFINITION",
            "THIRD-DEFINITION",
            "FOURTH-DEFINITION",
          ].filter((definition) => sent.includes(definition)),
          hasCodeChild: sent.includes("<code>") || sent.includes("<codes>"),
        }
      })
    ).toEqual([
      {
        entries: CHUNKS_PER_CALL,
        uniqueChunks: CHUNKS_PER_CALL,
        files: ["alpha.md", "beta.md"],
        definitions: ["THEMES-DEFINITION", "OTHER-DEFINITION", "THIRD-DEFINITION"],
        hasCodeChild: false,
      },
      {
        entries: 1,
        uniqueChunks: 1,
        files: ["alpha.md"],
        definitions: ["THEMES-DEFINITION", "OTHER-DEFINITION", "THIRD-DEFINITION"],
        hasCodeChild: false,
      },
      {
        entries: CHUNKS_PER_CALL,
        uniqueChunks: CHUNKS_PER_CALL,
        files: ["alpha.md", "beta.md"],
        definitions: ["FOURTH-DEFINITION"],
        hasCodeChild: false,
      },
      {
        entries: 1,
        uniqueChunks: 1,
        files: ["alpha.md"],
        definitions: ["FOURTH-DEFINITION"],
        hasCodeChild: false,
      },
    ])
    expect(MAX_CODES_PER_CALL).toBe(3)
  })
})

describe("adjudication verdicts", () => {
  it("batches dispute codes while sharing each contested chunk within a call", async () => {
    const { parse, calls } = respondingWith(() => ({ results: [] }))

    await adjudicateContestedSelections(
      ["themes", "other", "third", "fourth"].map(selectionFor),
      sources,
      resolve,
      parse
    )

    expect(
      calls.map((call) => {
        const sent = call.messages.map(textOf).join("\n")
        return {
          entries: sent.match(/<entry id=/g)?.length,
          disputes: sent.match(/<dispute /g)?.length,
          definitions: [
            "THEMES-DEFINITION",
            "OTHER-DEFINITION",
            "THIRD-DEFINITION",
            "FOURTH-DEFINITION",
          ].filter((definition) => sent.includes(definition)),
          chunks: sent.match(/\[1\.1\] First sentence\./g)?.length,
        }
      })
    ).toEqual([
      {
        entries: 1,
        disputes: 3,
        definitions: ["THEMES-DEFINITION", "OTHER-DEFINITION", "THIRD-DEFINITION"],
        chunks: 1,
      },
      {
        entries: 1,
        disputes: 1,
        definitions: ["FOURTH-DEFINITION"],
        chunks: 1,
      },
    ])
  })

  it("ignores a verdict naming a different active code than its dispute", async () => {
    const { parse, calls } = respondingWith(() => ({
      results: [
        {
          id: 1,
          dispute: 1,
          code: "other",
          judgment: "keep",
          reason: "off-batch code",
        },
      ],
    }))

    const result = await adjudicateContestedSelections(
      [selectionFor("themes")],
      sources,
      resolve,
      parse
    )

    expect(result.accepted).toEqual([])
    expect(result.errors).toHaveLength(1)
    const sent = calls[0].messages.map(textOf).join("\n")
    expect(sent).toContain("THEMES-DEFINITION")
    expect(sent).not.toContain("OTHER-DEFINITION")
  })

  it("matches a verdict to its dispute ordinal and code", async () => {
    const { parse } = respondingWith(() => ({
      results: [
        { id: 1, dispute: 1, code: "themes", judgment: "keep", reason: "one" },
        { id: 1, dispute: 2, code: "themes", judgment: "keep", reason: "two" },
      ],
    }))

    const result = await adjudicateContestedSelections(
      [selectionFor("themes"), selectionFor("other")],
      sources,
      resolve,
      parse
    )

    // The second verdict names the wrong code for dispute 2, so it is ignored
    // rather than cross-assigned and that selection remains unjudged.
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0].candidate.code).toBe("themes")
    expect(result.errors).toHaveLength(1)
  })
})
