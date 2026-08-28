import { describe, expect, it, vi } from "vitest"
import { err, ok } from "~/lib/fp/result"
import { respondingWith, textOf } from "~/lib/calls/parse.fixture"
import { buildCodingChunks } from "./coding-chunk"
import { runCodingPipeline } from "./coding-pipeline"
import { retrieveCodingCandidates, semanticGateCodingCandidates } from "./coding-candidates"
import { contestedEntry } from "./step-adjudicate"
import { assignIds, renderEntry } from "~/lib/calls/entry"
import type { CodingCandidate, CoderSelection } from "./step-code"
import type { SearchHit } from "~/domain/search/types"

const document = "First sentence. Second sentence. Third sentence. Fourth sentence."
const target = { path: "doc.md" }
const chunks = buildCodingChunks([target], () => document)
const candidate: CodingCandidate = {
  code: "themes",
  dimensionPath: "themes.generated.hidden.md",
  chunk: chunks[0],
}

const input = {
  targets: [target],
  dimensionPaths: [candidate.dimensionPath],
  sources: { framework: [], dimension: [] },
  files: { "doc.md": document },
  resolve: (path: string) => (path === "doc.md" ? document : "Code definition"),
}

describe("canonical coding pipeline", () => {
  it("does not query retrieval when the targets yield no chunks", async () => {
    const retrieve = vi.fn(async () => ok([] as SearchHit[]))
    const result = await retrieveCodingCandidates(
      [],
      [candidate.dimensionPath],
      { ctx: {} as never, files: {}, framework: "", resolveFile: () => "Code definition" },
      retrieve
    )

    expect(retrieve).not.toHaveBeenCalled()
    expect(result).toEqual({ candidates: [], errors: [] })
  })

  it("retrieval passthrough never calls retrieval and one coder directly determines the annotation", async () => {
    const retrieve = vi.fn(async () => err({ message: "must not run" }))
    const { parse, calls } = respondingWith(() => ({
      results: [{ code: "themes", start: "1.2", end: "1.2", reason: "specific" }],
    }))
    const result = await runCodingPipeline(
      {
        ...input,
        config: {
          passthrough: new Set(["retrieval", "semantic-filter"]),
          coders: ["voter-one"],
          adjudicate: false,
        },
      },
      { retrieve, parse }
    )

    expect(retrieve).not.toHaveBeenCalled()
    expect(calls.map((call) => call.endpoint)).toEqual(["/deep-analysis-filter.voter-one"])
    expect(result.errors).toEqual([])
    expect(result.envelopes.map((envelope) => envelope.markedText)).toEqual(["Second sentence."])
  })

  it("builds both coder requests once and changes only the endpoint", async () => {
    const { parse, calls } = respondingWith(() => ({ results: [] }))
    await runCodingPipeline(
      {
        ...input,
        config: {
          passthrough: new Set(["retrieval", "semantic-filter"]),
          coders: ["voter-one", "voter-two"],
          adjudicate: true,
        },
      },
      { parse }
    )

    expect(calls.map((call) => call.endpoint)).toEqual([
      "/deep-analysis-filter.voter-one",
      "/deep-analysis-filter.voter-two",
    ])
    expect(calls[1].messages).toEqual(calls[0].messages)
    expect(calls[0].messages.map(textOf).join("\n")).toContain("[1.4] Fourth sentence.")
  })

  it("drops a whole coder batch when a configured coder fails", async () => {
    const { parse } = respondingWith((endpoint) =>
      endpoint.endsWith("voter-two")
        ? new Error("coder unavailable")
        : { results: [{ code: "themes", start: "1.1", end: "1.1", reason: "one" }] }
    )
    const result = await runCodingPipeline(
      {
        ...input,
        config: {
          passthrough: new Set(["retrieval", "semantic-filter"]),
          coders: ["voter-one", "voter-two"],
          adjudicate: true,
        },
      },
      { parse }
    )
    expect(result.envelopes).toEqual([])
    expect(result.errors).toEqual(["/deep-analysis-filter.voter-two: coder unavailable"])
  })

  it("does not accept a one-sided selection when adjudication fails", async () => {
    const { parse } = respondingWith((endpoint) => {
      if (endpoint === "/deep-analysis-adjudicate") return new Error("adjudicator unavailable")
      if (endpoint.endsWith("voter-one"))
        return { results: [{ code: "themes", start: "1.1", end: "1.1", reason: "one" }] }
      return { results: [] }
    })
    const result = await runCodingPipeline(
      {
        ...input,
        config: {
          passthrough: new Set(["retrieval", "semantic-filter"]),
          coders: ["voter-one", "voter-two"],
          adjudicate: true,
        },
      },
      { parse }
    )
    expect(result.envelopes).toEqual([])
    expect(result.errors).toEqual(["adjudicator unavailable"])
  })

  it("semantic filtering uses results only as a gate and returns the untouched canonical chunk", async () => {
    const runVerdict = vi.fn(async (hits: SearchHit[]) => ({
      results: [{ ...hits[0], matches: ["Second sentence."], matchRanges: [{ start: 1, end: 1 }] }],
      failures: [],
      consumed: hits.length,
      barren: false,
      rawRemaining: [],
    }))
    const result = await semanticGateCodingCandidates(
      [candidate],
      input.files,
      input.resolve,
      runVerdict as never
    )
    expect(result.errors).toEqual([])
    expect(result.candidates).toEqual([candidate])
    expect(result.candidates[0]).toBe(candidate)
    expect(result.candidates[0].chunk.sentences.map((sentence) => sentence.text)).toEqual(
      chunks[0].sentences.map((sentence) => sentence.text)
    )
    expect(result.candidates[0]).not.toHaveProperty("matches")
    expect(result.candidates[0]).not.toHaveProperty("matchRanges")
  })

  it("adjudication entries provide the full chunk, positive provenance, and an explicit empty not-selected status", () => {
    const selection: CoderSelection = {
      candidate,
      coder: "voter-one",
      start: 2,
      end: 2,
      reason: "positive evidence",
    }
    const rendered = renderEntry(assignIds([contestedEntry(selection)])[0])
    expect(rendered).toContain('<voter-one status="selected">positive evidence</voter-one>')
    expect(rendered).toContain('<voter-two status="not selected"></voter-two>')
    expect(rendered).toContain("[1.1] First sentence.")
    expect(rendered).toContain("[1.4] Fourth sentence.")
    expect(rendered).not.toContain("negative reason")
  })
})
