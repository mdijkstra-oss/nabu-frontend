import { describe, expect, it, vi } from "vitest"
import { err, ok } from "~/lib/fp/result"
import { respondingWith, textOf } from "~/lib/calls/parse.fixture"
import { buildCodingChunks } from "./coding-chunk"
import { runCodingPipeline } from "./coding-pipeline"
import { retrieveCodingCandidates, semanticGateCodingCandidates } from "./coding-candidates"
import { contestedEntry, groupContestedSelections } from "./step-adjudicate"
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

const callout = (id: string, content: string): string =>
  [
    "```json-callout",
    JSON.stringify({
      id,
      type: "codebook-code",
      title: id,
      content,
      color: "blue",
      collapsed: false,
    }),
    "```",
  ].join("\n")

const input = {
  targets: [target],
  dimensionPaths: [candidate.dimensionPath],
  sources: { framework: [], dimension: [candidate.dimensionPath] },
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

  it("retrieval unions matching chunks, then applies every active code to each chunk", async () => {
    const otherPath = "other.generated.hidden.md"
    const retrieve = vi.fn(async (sql: string) =>
      sql.includes(candidate.dimensionPath)
        ? ok([{ file: "doc.md", hash: chunks[0].hash, score: 0.8 }] as SearchHit[])
        : ok([] as SearchHit[])
    )
    const result = await retrieveCodingCandidates(
      chunks,
      [candidate.dimensionPath, otherPath],
      { ctx: {} as never, files: {}, framework: "", resolveFile: () => "Code definition" },
      retrieve
    )

    expect(result.errors).toEqual([])
    expect(
      result.candidates.map(({ code, chunk }) => ({ code, chunk: chunk.id, score: chunk.score }))
    ).toEqual([
      { code: "themes", chunk: chunks[0].id, score: 0.8 },
      { code: "other", chunk: chunks[0].id, score: 0.8 },
    ])
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

  it("semantic filtering gates one shared chunk against every code", async () => {
    const other: CodingCandidate = {
      code: "other",
      dimensionPath: "other.generated.hidden.md",
      chunk: candidate.chunk,
    }
    const { parse, calls } = respondingWith(() => ({
      results: [{ id: 1, reason: "could match either code" }],
    }))
    const result = await semanticGateCodingCandidates(
      [candidate, other],
      { framework: [], dimension: [candidate.dimensionPath, other.dimensionPath] },
      input.resolve,
      parse
    )
    expect(result.errors).toEqual([])
    expect(result.candidates).toEqual([candidate, other])
    expect(result.candidates[0]).toBe(candidate)
    expect(result.candidates[0].chunk.sentences.map((sentence) => sentence.text)).toEqual(
      chunks[0].sentences.map((sentence) => sentence.text)
    )
    expect(result.candidates[0]).not.toHaveProperty("matches")
    expect(result.candidates[0]).not.toHaveProperty("matchRanges")
    expect(calls.map((call) => call.endpoint)).toEqual(["/deep-analysis-semantic-filter"])
    const sent = calls[0].messages.map(textOf).join("\n")
    expect(sent.match(/\[1\.1\] First sentence\./g)).toHaveLength(1)
    expect(sent).not.toContain("<code>")
    expect(sent).not.toContain("<codes>")
  })

  it("semantic filtering unions retained chunks across bounded code batches", async () => {
    const codes = ["themes", "other", "third", "fourth"]
    const candidates = codes.map((code) => ({
      ...candidate,
      code,
      dimensionPath: `${code}.generated.hidden.md`,
    }))
    const definitions = codes.map((code) => callout(code, `${code.toUpperCase()}-DEFINITION`))
    const resolve = (path: string): string | undefined =>
      path === "codes.md" ? definitions.join("\n\n") : input.resolve(path)
    const { parse, calls } = respondingWith((_endpoint, messages) => {
      const sent = messages.map(textOf).join("\n")
      return { results: sent.includes("FOURTH-DEFINITION") ? [{ id: 1, reason: "fourth" }] : [] }
    })

    const result = await semanticGateCodingCandidates(
      candidates,
      { framework: [], dimension: ["codes.md"] },
      resolve,
      parse
    )

    expect(result).toEqual({ candidates, errors: [] })
    expect(
      calls.map((call) => {
        const sent = call.messages.map(textOf).join("\n")
        return {
          definitions: codes.filter((code) => sent.includes(`${code.toUpperCase()}-DEFINITION`)),
          chunks: sent.match(/\[1\.1\] First sentence\./g)?.length,
        }
      })
    ).toEqual([
      { definitions: ["themes", "other", "third"], chunks: 1 },
      { definitions: ["fourth"], chunks: 1 },
    ])
  })

  it("adjudication groups disputes over one shared full chunk", () => {
    const selection: CoderSelection = {
      candidate,
      coder: "voter-one",
      start: 2,
      end: 2,
      reason: "positive evidence",
    }
    const other: CoderSelection = {
      candidate: { ...candidate, code: "other" },
      coder: "voter-two",
      start: 3,
      end: 3,
      reason: "other evidence",
    }
    const group = groupContestedSelections([selection, other])[0]
    const rendered = renderEntry(assignIds([contestedEntry(group)])[0])
    expect(rendered).toContain(
      '<dispute id="1" code="themes" start="2" end="2" voter-one="selected" voter-two="not-selected">positive evidence</dispute>'
    )
    expect(rendered).toContain(
      '<dispute id="2" code="other" start="3" end="3" voter-one="not-selected" voter-two="selected">other evidence</dispute>'
    )
    expect(rendered).toContain("[1.1] First sentence.")
    expect(rendered).toContain("[1.4] Fourth sentence.")
    expect(rendered.match(/\[1\.1\] First sentence\./g)).toHaveLength(1)
    expect(rendered).not.toContain("<candidate>")
    expect(rendered).not.toContain("<code>")
  })
})
