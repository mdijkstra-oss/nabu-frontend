import { describe, it, expect } from "vitest"
import { block } from "~/lib/data-blocks/test-helpers"
import { sampleChunks } from "./sample"

const attrs = (type: string, subject: string): string =>
  block("json-attributes", JSON.stringify({ type, subject, hash: "abc" }))

const embedding = (text: string, language = "eng"): string =>
  block(
    "json-embeddings",
    JSON.stringify({
      hash: "h",
      text,
      embedding: [0.1],
      chunkStart: 0,
      chunkEnd: text.length,
      language,
    })
  )

const doc = (type: string, subject: string): string => `# Doc\n\n${attrs(type, subject)}`

const companion = (...entries: string[]): string => entries.join("\n\n")

interface Case {
  name: string
  files: Record<string, string>
  corpus: string
  language: string
  count: number
  expected: { minLength: number; maxLength: number; containsAll?: string[] }
}

const cases: Case[] = [
  {
    name: "returns texts from matching group and language",
    files: {
      "report.md": doc("report", "quarterly"),
      "report.embeddings.hidden.md": companion(
        embedding("financial results Q1"),
        embedding("revenue growth trends")
      ),
    },
    corpus: "report:quarterly",
    language: "eng",
    count: 10,
    expected: {
      minLength: 2,
      maxLength: 2,
      containsAll: ["financial results Q1", "revenue growth trends"],
    },
  },
  {
    name: "filters by language",
    files: {
      "doc.md": doc("article", "science"),
      "doc.embeddings.hidden.md": companion(
        embedding("english text", "eng"),
        embedding("texte français", "fra")
      ),
    },
    corpus: "article:science",
    language: "fra",
    count: 10,
    expected: { minLength: 1, maxLength: 1, containsAll: ["texte français"] },
  },
  {
    name: "returns empty for non-matching group",
    files: {
      "doc.md": doc("memo", "planning"),
      "doc.embeddings.hidden.md": companion(embedding("some text")),
    },
    corpus: "other:topic",
    language: "eng",
    count: 10,
    expected: { minLength: 0, maxLength: 0 },
  },
  {
    name: "skips files without companions",
    files: {
      "doc.md": doc("memo", "planning"),
    },
    corpus: "memo:planning",
    language: "eng",
    count: 10,
    expected: { minLength: 0, maxLength: 0 },
  },
  {
    name: "caps at count",
    files: {
      "doc.md": doc("report", "topic"),
      "doc.embeddings.hidden.md": companion(
        embedding("text 1"),
        embedding("text 2"),
        embedding("text 3"),
        embedding("text 4"),
        embedding("text 5")
      ),
    },
    corpus: "report:topic",
    language: "eng",
    count: 2,
    expected: { minLength: 2, maxLength: 2 },
  },
  {
    name: "skips non-embeddable files",
    files: {
      "doc.hidden.md": doc("report", "topic"),
      "doc.hidden.embeddings.hidden.md": companion(embedding("hidden text")),
    },
    corpus: "report:topic",
    language: "eng",
    count: 10,
    expected: { minLength: 0, maxLength: 0 },
  },
  {
    name: "general:general samples from all embeddable files",
    files: {
      "a.md": doc("report", "quarterly"),
      "a.embeddings.hidden.md": companion(embedding("text from report")),
      "b.md": doc("memo", "planning"),
      "b.embeddings.hidden.md": companion(embedding("text from memo")),
    },
    corpus: "general:general",
    language: "eng",
    count: 10,
    expected: {
      minLength: 2,
      maxLength: 2,
      containsAll: ["text from report", "text from memo"],
    },
  },
]

describe("sampleChunks", () => {
  it.each(cases)("$name", ({ files, corpus, language, count, expected }) => {
    const result = sampleChunks(files, corpus, language, count)
    expect(result.length).toBeGreaterThanOrEqual(expected.minLength)
    expect(result.length).toBeLessThanOrEqual(expected.maxLength)
    if (expected.containsAll) {
      for (const text of expected.containsAll) {
        expect(result).toContain(text)
      }
    }
  })
})
