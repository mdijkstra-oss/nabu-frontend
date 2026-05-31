import { describe, it, expect } from "vitest"
import { extractSearchSlice, growHits, refreshHits } from "./slices"

interface TestAnnotation {
  text: string
  reason: string
  color: string
  id?: string
}

const makeAnnotations = (annotations: TestAnnotation[]): string =>
  "```json-annotations\n" + JSON.stringify({ annotations }) + "\n```"

const makeAttrs = (attrs: { tags?: string[] }): string =>
  "```json-attributes\n" + JSON.stringify(attrs) + "\n```"

const makeDoc = (prose: string, annotations: TestAnnotation[], tags?: string[]): string => {
  const parts = [prose]
  if (tags) parts.push(makeAttrs({ tags }))
  parts.push(makeAnnotations(annotations))
  return parts.join("\n\n")
}

const formatExpectedBlock = (annotations: TestAnnotation[]): string =>
  "```json-annotations\n" + JSON.stringify({ annotations }) + "\n```"

describe("extractSearchSlice", () => {
  const cases: {
    name: string
    hit: { file: string; id?: string; text?: string; matches?: string[] }
    fileContent: string
    expected: string | null
  }[] = [
    {
      name: "returns null when no text, no matches, no id",
      hit: { file: "doc.md" },
      fileContent: "# Doc",
      expected: null,
    },
    {
      name: "returns null when text but no matches and no id",
      hit: { file: "doc.md", text: "some chunk" },
      fileContent: "# Doc\n\nsome chunk content",
      expected: null,
    },
    {
      name: "trims around matches in prose",
      hit: { file: "doc.md", matches: ["key insight"] },
      fileContent: "intro text. key insight here. conclusion text.",
      expected: "intro text. key insight here. conclusion text.",
    },
    {
      name: "trims around matches with no annotations in file",
      hit: { file: "doc.md", matches: ["important finding"] },
      fileContent: "Some context. important finding is noted. More text follows.",
      expected: "Some context. important finding is noted. More text follows.",
    },
    {
      name: "trims around matches and attaches footed annotation",
      hit: { file: "doc.md", matches: ["key insight"] },
      fileContent: makeDoc("intro. key insight here. conclusion.", [
        { text: "key insight here", reason: "important", color: "blue" },
      ]),
      expected: `intro. key insight here. conclusion.\n\n${formatExpectedBlock([{ text: "key insight here", reason: "important", color: "blue" }])}`,
    },
    {
      name: "excludes annotation with no footing in trimmed region",
      hit: { file: "doc.md", matches: ["paragraph one"] },
      fileContent: makeDoc(
        "paragraph one is here. " +
          Array.from({ length: 40 }, (_, i) => `Filler sentence ${i}.`).join(" ") +
          " Paragraph two is distant.",
        [{ text: "Paragraph two is distant.", reason: "r", color: "blue" }]
      ),
      expected: "CONTAINS:paragraph one is here",
    },
    {
      name: "id-only hit resolves anchor from annotation text",
      hit: { file: "doc.md", id: "ann-1" },
      fileContent: makeDoc("some context. the annotated passage here. more text.", [
        { text: "the annotated passage here", reason: "r", color: "blue", id: "ann-1" },
      ]),
      expected: `some context. the annotated passage here. more text.\n\n${formatExpectedBlock([{ text: "the annotated passage here", reason: "r", color: "blue", id: "ann-1" }])}`,
    },
    {
      name: "id-only hit with no matching annotation returns null",
      hit: { file: "doc.md", id: "missing-id" },
      fileContent: makeDoc("some text here.", [
        { text: "some text", reason: "r", color: "blue", id: "ann-1" },
      ]),
      expected: null,
    },
    {
      name: "id hit filters to matching annotation only",
      hit: { file: "doc.md", id: "ann-1", matches: ["middle part"] },
      fileContent: makeDoc("left middle part right.", [
        { text: "left middle", reason: "a", color: "blue", id: "ann-1" },
        { text: "middle part right", reason: "b", color: "red", id: "ann-2" },
      ]),
      expected: `left middle part right.\n\n${formatExpectedBlock([
        { text: "left middle", reason: "a", color: "blue", id: "ann-1" },
      ])}`,
    },
    {
      name: "ignores tags in attributes block",
      hit: { file: "doc.md", matches: ["key insight"] },
      fileContent: makeDoc(
        "key insight here.",
        [{ text: "key insight", reason: "r", color: "blue" }],
        ["interview"]
      ),
      expected:
        `key insight here.\n\n` +
        formatExpectedBlock([{ text: "key insight", reason: "r", color: "blue" }]),
    },
    {
      name: "returns null for empty file content with id-only hit",
      hit: { file: "doc.md", id: "ann-1" },
      fileContent: "",
      expected: null,
    },
    {
      name: "matches with empty file returns hit text",
      hit: { file: "doc.md", matches: ["hello"], text: "hello world" },
      fileContent: "",
      expected: "hello world",
    },
  ]

  it.each(cases)("$name", ({ hit, fileContent, expected }) => {
    const result = extractSearchSlice(hit, fileContent)
    if (typeof expected === "string" && expected.startsWith("CONTAINS:")) {
      const substring = expected.slice("CONTAINS:".length)
      expect(result).toContain(substring)
      expect(result).not.toContain("json-annotations")
    } else {
      expect(result).toBe(expected)
    }
  })
})

describe("growHits", () => {
  const ann = (text: string): TestAnnotation => ({ text, reason: "r", color: "blue" })

  const growCases: {
    name: string
    hits: { file: string; id?: string; text?: string; matches?: string[] }[]
    files: Record<string, string>
    expected: { file: string; id?: string; text?: string; matches?: string[] }[] | string
  }[] = [
    {
      name: "deduplicates hits with identical expanded text in same file",
      hits: [
        { file: "doc.md", id: "ann-1", matches: ["hello"] },
        { file: "doc.md", id: "ann-2", matches: ["hello"] },
      ],
      files: { "doc.md": "hello world." },
      expected: [{ file: "doc.md", id: "ann-1", matches: ["hello"], text: "hello world." }],
    },
    {
      name: "keeps hits with same text in different files",
      hits: [
        { file: "a.md", matches: ["hello"] },
        { file: "b.md", matches: ["hello"] },
      ],
      files: { "a.md": "hello.", "b.md": "hello." },
      expected: [
        { file: "a.md", matches: ["hello"], text: "hello." },
        { file: "b.md", matches: ["hello"], text: "hello." },
      ],
    },
    {
      name: "deduplicates hits that trim to same text in same file",
      hits: [
        { file: "doc.md", matches: ["alpha"] },
        { file: "doc.md", matches: ["beta"] },
      ],
      files: { "doc.md": "alpha sentence. beta sentence." },
      expected: [{ file: "doc.md", matches: ["alpha"], text: "alpha sentence. beta sentence." }],
    },
    {
      name: "keeps hits with different trimmed text in same file",
      hits: [
        { file: "doc.md", matches: ["Alpha target"] },
        { file: "doc.md", matches: ["Beta target"] },
      ],
      files: {
        "doc.md":
          "Alpha target is here. " +
          Array.from({ length: 40 }, (_, i) => `Filler sentence ${i}.`).join(" ") +
          " Beta target is there.",
      },
      expected: "DIFFERENT_TEXTS",
    },
    {
      name: "passes through file-only hits without dedup",
      hits: [{ file: "doc.md" }, { file: "doc.md" }],
      files: { "doc.md": "content" },
      expected: [{ file: "doc.md" }, { file: "doc.md" }],
    },
    {
      name: "deduplicates after annotation expansion produces same text",
      hits: [
        { file: "doc.md", id: "ann-1" },
        { file: "doc.md", id: "ann-2" },
      ],
      files: {
        "doc.md": makeDoc("key insight here.", [
          { ...ann("key insight"), id: "ann-1" },
          { ...ann("key insight"), id: "ann-2" },
        ]),
      },
      expected: [
        {
          file: "doc.md",
          id: "ann-1",
          text: `key insight here.\n\n${formatExpectedBlock([{ ...ann("key insight"), id: "ann-1" }])}`,
        },
      ],
    },
  ]

  it.each(growCases)("$name", ({ hits, files, expected }) => {
    if (expected === "DIFFERENT_TEXTS") {
      const result = growHits(hits, files)
      expect(result).toHaveLength(2)
      expect(result[0].text).not.toBe(result[1].text)
    } else {
      expect(growHits(hits, files)).toEqual(expected)
    }
  })
})

describe("refreshHits", () => {
  const ann = (text: string) => ({ text, reason: "r", color: "blue" })

  const refreshCases: {
    name: string
    hits: { file: string; id?: string; text?: string; matches?: string[] }[]
    files: Record<string, string>
    expected: { file: string; id?: string; text?: string; matches?: string[] }[]
  }[] = [
    {
      name: "drops hit when file is gone",
      hits: [{ file: "gone.md", text: "hello", matches: ["hello"] }],
      files: {},
      expected: [],
    },
    {
      name: "drops ID hit when ID no longer in file",
      hits: [{ file: "doc.md", id: "deleted-id" }],
      files: { "doc.md": "# Doc\n\nSome content" },
      expected: [],
    },
    {
      name: "keeps ID hit when ID still in file",
      hits: [{ file: "doc.md", id: "alive-id" }],
      files: { "doc.md": '# Doc\n\n```json-callout\n{"id":"alive-id"}\n```' },
      expected: [{ file: "doc.md", id: "alive-id" }],
    },
    {
      name: "keeps file-only hit when file exists",
      hits: [{ file: "doc.md" }],
      files: { "doc.md": "# Doc" },
      expected: [{ file: "doc.md" }],
    },
    {
      name: "keeps text hit with matches and strips stale annotations",
      hits: [
        {
          file: "doc.md",
          matches: ["hello"],
          text: `hello world.\n\n${makeAnnotations([ann("hello")])}`,
        },
      ],
      files: { "doc.md": "hello world. other stuff." },
      expected: [{ file: "doc.md", matches: ["hello"], text: "hello world. other stuff." }],
    },
    {
      name: "keeps text hit with matches and re-grows with surviving annotations",
      hits: [
        {
          file: "doc.md",
          matches: ["hello"],
          text: `hello world.\n\n${makeAnnotations([ann("hello"), ann("missing")])}`,
        },
      ],
      files: {
        "doc.md": makeDoc("hello world. other stuff.", [ann("hello")]),
      },
      expected: [
        {
          file: "doc.md",
          matches: ["hello"],
          text: `hello world. other stuff.\n\n${formatExpectedBlock([ann("hello")])}`,
        },
      ],
    },
    {
      name: "deduplicates hits that regrow to identical text",
      hits: [
        { file: "doc.md", id: "ann-1", matches: ["hello"], text: "hello" },
        { file: "doc.md", id: "ann-2", matches: ["hello"], text: "hello" },
      ],
      files: { "doc.md": "hello world. ann-1 ann-2." },
      expected: [
        { file: "doc.md", id: "ann-1", matches: ["hello"], text: "hello world. ann-1 ann-2." },
      ],
    },
  ]

  it.each(refreshCases)("$name", ({ hits, files, expected }) => {
    expect(refreshHits(hits, files)).toEqual(expected)
  })
})
