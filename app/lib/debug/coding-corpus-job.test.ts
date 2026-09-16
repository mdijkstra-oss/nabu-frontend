import { describe, expect, it } from "vitest"
import { respondingWith, textOf } from "~/lib/calls/parse.fixture"
import { runCodingCorpus } from "./coding-eval"
import { parseCodingCorpusJob } from "./coding-corpus-job"

describe("coding corpus job", () => {
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
  })
})
