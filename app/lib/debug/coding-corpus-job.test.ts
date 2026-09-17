import { describe, expect, it } from "vitest"
import { respondingWith, textOf } from "~/lib/calls/parse.fixture"
import { parsePositiveInteger, runCodingCorpus } from "./coding-eval"
import { parseCodingCorpusJob } from "./coding-corpus-job"

describe("coding corpus job", () => {
  it("accepts only positive whole-number batching limits", () => {
    expect(parsePositiveInteger("4", "max-codes-per-call")).toBe(4)
    expect(() => parsePositiveInteger("0", "max-codes-per-call")).toThrow(
      "--max-codes-per-call must be a positive integer"
    )
  })

  it("parses normal source files without evaluation metadata", () => {
    expect(
      parseCodingCorpusJob({
        framework: { path: "framework.md", markdown: "Shared context." },
        dimensions: [{ path: "codes/code-a.md", markdown: "A definition." }],
        documents: [{ path: "document.md", markdown: "A document." }],
      })
    ).toEqual({
      frameworkPath: "framework.md",
      frameworkMarkdown: "Shared context.",
      dimensions: [{ path: "codes/code-a.md", markdown: "A definition." }],
      documents: [{ path: "document.md", markdown: "A document." }],
    })
  })

  it("runs every supplied document through one coding invocation", async () => {
    const { parse, calls } = respondingWith(() => ({
      results: [
        { code: "code-a", start: "1.1", end: "1.1", reason: "alpha" },
        { code: "code-a", start: "2.1", end: "2.1", reason: "beta" },
      ],
    }))
    const result = await runCodingCorpus(
      {
        documents: [
          { path: "alpha.md", markdown: "Alpha sentence." },
          { path: "beta.md", markdown: "Beta sentence." },
        ],
        frameworkPath: "framework.md",
        frameworkMarkdown: "Apply every supplied code.",
        dimensions: [
          {
            path: "codes/code-a.md",
            markdown:
              '```json-callout\n{"id":"code-a","type":"codebook-code","title":"Code A","content":"Apply this code.","color":"blue","collapsed":false}\n```',
          },
        ],
      },
      { parse }
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].messages.map(textOf).join("\n")).toContain('<entry id="1" file="alpha.md">')
    expect(result.documents.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: "alpha.md", status: "success" },
      { path: "beta.md", status: "success" },
    ])
    expect(result.stages).toEqual([
      { stage: "candidates", chunks: 2, candidates: 2 },
      { stage: "voters", selections: { "voter-one": 2 }, errors: 0 },
      { stage: "decisions", decisions: 2 },
    ])
  })

  it("records consensus and adjudication counts without retaining model text", async () => {
    const { parse } = respondingWith((endpoint) => {
      if (endpoint.endsWith("voter-one"))
        return { results: [{ code: "code-a", start: "1.1", end: "1.1", reason: "one" }] }
      if (endpoint.endsWith("voter-two")) return { results: [] }
      return {
        results: [{ id: 1, dispute: 1, code: "code-a", judgment: "keep", reason: "reviewed" }],
      }
    })
    const result = await runCodingCorpus(
      {
        documents: [{ path: "alpha.md", markdown: "Alpha sentence." }],
        frameworkPath: "framework.md",
        frameworkMarkdown: "Apply every supplied code.",
        dimensions: [
          {
            path: "codes/code-a.md",
            markdown:
              '```json-callout\n{"id":"code-a","type":"codebook-code","title":"Code A","content":"Apply this code.","color":"blue","collapsed":false}\n```',
          },
        ],
      },
      { parse },
      {
        passthrough: new Set(["retrieval", "semantic-filter"]),
        coders: ["voter-one", "voter-two"],
        adjudicate: true,
      }
    )

    expect(result.stages).toEqual([
      { stage: "candidates", chunks: 1, candidates: 1 },
      {
        stage: "voters",
        selections: { "voter-one": 1, "voter-two": 0 },
        errors: 0,
      },
      { stage: "consensus", accepted: 0, contested: 1 },
      { stage: "adjudication", contested: 1, accepted: 1, errors: 0 },
      { stage: "decisions", decisions: 1 },
    ])
  })
})
