import { describe, it, expect } from "vitest"
import { extractSearchSlice, growHits, refreshHits } from "./slices"

interface TestAnnotation { text: string; reason: string; color: string; id?: string }

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
    hit: { file: string; id?: string; text?: string }
    fileContent: string
    expected: string | null
  }[] = [
    {
      name: "returns null when no text",
      hit: { file: "doc.md" },
      fileContent: "# Doc",
      expected: null,
    },
    {
      name: "returns null for id-only hit",
      hit: { file: "doc.md", id: "callout-1" },
      fileContent: "# Doc",
      expected: null,
    },
    {
      name: "returns text as-is when no annotations block",
      hit: { file: "doc.md", text: "some chunk content" },
      fileContent: "# Doc\n\nsome chunk content",
      expected: "some chunk content",
    },
    {
      name: "returns text as-is when file content is empty",
      hit: { file: "doc.md", text: "some text" },
      fileContent: "",
      expected: "some text",
    },
    {
      name: "returns text as-is when no annotations overlap",
      hit: { file: "doc.md", text: "paragraph one" },
      fileContent: makeDoc("paragraph one\n\nparagraph two", [
        { text: "paragraph two", reason: "r", color: "blue" },
      ]),
      expected: "paragraph one",
    },
    {
      name: "strips meta tags from hit text before matching",
      hit: { file: "doc.md", text: "key insight here\n<meta>some reason</meta>" },
      fileContent: makeDoc("intro text\n\nkey insight here and more", [
        { text: "key insight here", reason: "some reason", color: "blue" },
      ]),
      expected: `key insight here\n\n${formatExpectedBlock([{ text: "key insight here", reason: "some reason", color: "blue" }])}`,
    },
    {
      name: "strips meta from fallback when slice not found in prose",
      hit: { file: "doc.md", text: "orphaned text\n<meta>stale reason</meta>" },
      fileContent: "completely different content",
      expected: "orphaned text",
    },
    {
      name: "appends overlapping annotations block",
      hit: { file: "doc.md", text: "key insight here" },
      fileContent: makeDoc("intro text\n\nkey insight here and more", [
        { text: "key insight here", reason: "important", color: "blue" },
      ]),
      expected: `key insight here\n\n${formatExpectedBlock([{ text: "key insight here", reason: "important", color: "blue" }])}`,
    },
    {
      name: "expands text to encompass overlapping annotation",
      hit: { file: "doc.md", text: "insight" },
      fileContent: makeDoc("some key insight here", [
        { text: "key insight here", reason: "important", color: "blue" },
      ]),
      expected: `key insight here\n\n${formatExpectedBlock([{ text: "key insight here", reason: "important", color: "blue" }])}`,
    },
    {
      name: "expands to bounding box of multiple overlapping annotations",
      hit: { file: "doc.md", text: "middle part" },
      fileContent: makeDoc("left middle part right", [
        { text: "left middle", reason: "a", color: "blue" },
        { text: "middle part right", reason: "b", color: "red" },
      ]),
      expected: `left middle part right\n\n${formatExpectedBlock([
        { text: "left middle", reason: "a", color: "blue" },
        { text: "middle part right", reason: "b", color: "red" },
      ])}`,
    },
    {
      name: "does not cascade to annotations outside original slice",
      hit: { file: "doc.md", text: "BBB" },
      fileContent: makeDoc("AAA BBB CCC DDD EEE", [
        { text: "AAA BBB", reason: "a", color: "blue" },
        { text: "DDD EEE", reason: "b", color: "red" },
      ]),
      expected: `AAA BBB\n\n${formatExpectedBlock([{ text: "AAA BBB", reason: "a", color: "blue" }])}`,
    },
    {
      name: "ignores tags in attributes block",
      hit: { file: "doc.md", text: "key insight" },
      fileContent: makeDoc(
        "key insight here",
        [{ text: "key insight", reason: "r", color: "blue" }],
        ["interview"]
      ),
      expected:
        `key insight\n\n` +
        formatExpectedBlock([{ text: "key insight", reason: "r", color: "blue" }]),
    },
    {
      name: "hit id filters to matching annotation only",
      hit: { file: "doc.md", id: "ann-1", text: "middle part" },
      fileContent: makeDoc("left middle part right", [
        { text: "left middle", reason: "a", color: "blue", id: "ann-1" },
        { text: "middle part right", reason: "b", color: "red", id: "ann-2" },
      ]),
      expected: `left middle part\n\n${formatExpectedBlock([
        { text: "left middle", reason: "a", color: "blue", id: "ann-1" },
      ])}`,
    },
    {
      name: "hit id with no matching annotation falls back to all overlapping",
      hit: { file: "doc.md", id: "ann-missing", text: "middle part" },
      fileContent: makeDoc("left middle part right", [
        { text: "left middle", reason: "a", color: "blue", id: "ann-1" },
        { text: "middle part right", reason: "b", color: "red", id: "ann-2" },
      ]),
      expected: `left middle part right\n\n${formatExpectedBlock([
        { text: "left middle", reason: "a", color: "blue", id: "ann-1" },
        { text: "middle part right", reason: "b", color: "red", id: "ann-2" },
      ])}`,
    },
    {
      name: "hit without id still includes all overlapping annotations",
      hit: { file: "doc.md", text: "middle part" },
      fileContent: makeDoc("left middle part right", [
        { text: "left middle", reason: "a", color: "blue", id: "ann-1" },
        { text: "middle part right", reason: "b", color: "red", id: "ann-2" },
      ]),
      expected: `left middle part right\n\n${formatExpectedBlock([
        { text: "left middle", reason: "a", color: "blue", id: "ann-1" },
        { text: "middle part right", reason: "b", color: "red", id: "ann-2" },
      ])}`,
    },
  ]

  it.each(cases)("$name", ({ hit, fileContent, expected }) => {
    expect(extractSearchSlice(hit, fileContent)).toBe(expected)
  })
})

describe("growHits", () => {
  const ann = (text: string): TestAnnotation => ({ text, reason: "r", color: "blue" })

  const growCases: {
    name: string
    hits: { file: string; id?: string; text?: string }[]
    files: Record<string, string>
    expected: { file: string; id?: string; text?: string }[]
  }[] = [
    {
      name: "deduplicates hits with identical expanded text in same file",
      hits: [
        { file: "doc.md", id: "ann-1", text: "hello" },
        { file: "doc.md", id: "ann-2", text: "hello" },
      ],
      files: { "doc.md": "hello world" },
      expected: [{ file: "doc.md", id: "ann-1", text: "hello" }],
    },
    {
      name: "keeps hits with same text in different files",
      hits: [
        { file: "a.md", text: "hello" },
        { file: "b.md", text: "hello" },
      ],
      files: { "a.md": "hello", "b.md": "hello" },
      expected: [
        { file: "a.md", text: "hello" },
        { file: "b.md", text: "hello" },
      ],
    },
    {
      name: "keeps hits with different expanded text in same file",
      hits: [
        { file: "doc.md", text: "alpha" },
        { file: "doc.md", text: "beta" },
      ],
      files: { "doc.md": "alpha\n\nbeta" },
      expected: [
        { file: "doc.md", text: "alpha" },
        { file: "doc.md", text: "beta" },
      ],
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
        { file: "doc.md", id: "ann-1", text: "key insight" },
        { file: "doc.md", id: "ann-2", text: "key insight" },
      ],
      files: {
        "doc.md": makeDoc("key insight here", [
          { ...ann("key insight"), id: "ann-1" },
          { ...ann("key insight"), id: "ann-2" },
        ]),
      },
      expected: [
        {
          file: "doc.md",
          id: "ann-1",
          text: `key insight\n\n${formatExpectedBlock([{ ...ann("key insight"), id: "ann-1" }])}`,
        },
      ],
    },
  ]

  it.each(growCases)("$name", ({ hits, files, expected }) => {
    expect(growHits(hits, files)).toEqual(expected)
  })
})

describe("refreshHits", () => {
  const ann = (text: string) => ({ text, reason: "r", color: "blue" })

  const refreshCases: {
    name: string
    hits: { file: string; id?: string; text?: string }[]
    files: Record<string, string>
    expected: { file: string; id?: string; text?: string }[]
  }[] = [
    {
      name: "drops hit when file is gone",
      hits: [{ file: "gone.md", text: "hello" }],
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
      name: "keeps text hit and strips stale annotations",
      hits: [
        {
          file: "doc.md",
          text: `hello world\n\n${makeAnnotations([ann("hello")])}`,
        },
      ],
      files: { "doc.md": "hello world\n\nother stuff" },
      expected: [{ file: "doc.md", text: "hello world" }],
    },
    {
      name: "keeps text hit and re-grows with surviving annotations",
      hits: [
        {
          file: "doc.md",
          text: `hello world\n\n${makeAnnotations([ann("hello"), ann("missing")])}`,
        },
      ],
      files: {
        "doc.md": makeDoc("hello world\n\nother stuff", [ann("hello")]),
      },
      expected: [
        {
          file: "doc.md",
          text: `hello world\n\n${formatExpectedBlock([ann("hello")])}`,
        },
      ],
    },
    {
      name: "deduplicates hits that regrow to identical text",
      hits: [
        { file: "doc.md", id: "ann-1", text: "hello" },
        { file: "doc.md", id: "ann-2", text: "hello" },
      ],
      files: { "doc.md": "hello world ann-1 ann-2" },
      expected: [{ file: "doc.md", id: "ann-1", text: "hello" }],
    },
  ]

  it.each(refreshCases)("$name", ({ hits, files, expected }) => {
    expect(refreshHits(hits, files)).toEqual(expected)
  })
})
