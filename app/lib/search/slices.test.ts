import { describe, it, expect } from "vitest"
import { growHits, attachAnnotationsOnly, refreshHits } from "./slices"

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

const ann = (text: string, id?: string): TestAnnotation => ({
  text,
  reason: "r",
  color: "blue",
  ...(id ? { id } : {}),
})

describe("growHits — trim mode", () => {
  const cases: {
    name: string
    hits: { file: string; id?: string; text?: string; matches?: string[] }[]
    files: Record<string, string>
    expected: { file: string; id?: string; text?: string; matches?: string[] }[]
  }[] = [
    {
      name: "single match — trims around match, no annotations to attach",
      hits: [{ file: "doc.md", matches: ["important finding here"] }],
      files: { "doc.md": "intro line. important finding here. conclusion line." },
      expected: [
        {
          file: "doc.md",
          matches: ["important finding here"],
          text: "intro line. important finding here. conclusion line.",
        },
      ],
    },
    {
      name: "attaches annotation when fully present in region",
      hits: [{ file: "doc.md", matches: ["the relevant passage"] }],
      files: {
        "doc.md": makeDoc("intro. the relevant passage is here. outro.", [
          ann("the relevant passage is here"),
        ]),
      },
      expected: [
        {
          file: "doc.md",
          matches: ["the relevant passage"],
          text: `intro. the relevant passage is here. outro.\n\n${formatExpectedBlock([ann("the relevant passage is here")])}`,
        },
      ],
    },
    {
      name: "grows region tail when annotation extends past region end",
      hits: [{ file: "doc.md", matches: ["alpha bravo charlie"] }],
      files: {
        "doc.md": makeDoc("alpha bravo charlie delta echo.", [
          ann("alpha bravo charlie delta echo"),
        ]),
      },
      expected: [
        {
          file: "doc.md",
          matches: ["alpha bravo charlie"],
          text: `alpha bravo charlie delta echo.\n\n${formatExpectedBlock([ann("alpha bravo charlie delta echo")])}`,
        },
      ],
    },
    {
      name: "skips annotation below minWords threshold",
      hits: [{ file: "doc.md", matches: ["short marker"] }],
      files: {
        "doc.md": makeDoc("here is short marker text.", [ann("short marker")]),
      },
      expected: [
        {
          file: "doc.md",
          matches: ["short marker"],
          text: "here is short marker text.",
        },
      ],
    },
    {
      name: "restricts candidates by hit.id when present",
      hits: [{ file: "doc.md", id: "ann-1", matches: ["the middle portion only"] }],
      files: {
        "doc.md": makeDoc("left the middle portion only right.", [
          ann("the middle portion only", "ann-1"),
          ann("the middle portion only", "ann-2"),
        ]),
      },
      expected: [
        {
          file: "doc.md",
          id: "ann-1",
          matches: ["the middle portion only"],
          text: `left the middle portion only right.\n\n${formatExpectedBlock([ann("the middle portion only", "ann-1")])}`,
        },
      ],
    },
    {
      name: "deduplicates regions with identical text in same file",
      hits: [
        { file: "doc.md", id: "ann-1", matches: ["hello world together"] },
        { file: "doc.md", id: "ann-2", matches: ["hello world together"] },
      ],
      files: { "doc.md": "hello world together." },
      expected: [
        {
          file: "doc.md",
          id: "ann-1",
          matches: ["hello world together"],
          text: "hello world together.",
        },
      ],
    },
    {
      name: "passes file-only hits through unchanged",
      hits: [{ file: "doc.md" }],
      files: { "doc.md": "content here" },
      expected: [{ file: "doc.md" }],
    },
    {
      name: "id-only hit resolves anchor from annotation text",
      hits: [{ file: "doc.md", id: "ann-1" }],
      files: {
        "doc.md": makeDoc("some context here. the annotated passage here. more text follows.", [
          ann("the annotated passage here", "ann-1"),
        ]),
      },
      expected: [
        {
          file: "doc.md",
          id: "ann-1",
          text: `some context here. the annotated passage here. more text follows.\n\n${formatExpectedBlock([ann("the annotated passage here", "ann-1")])}`,
        },
      ],
    },
  ]

  it.each(cases)("$name", ({ hits, files, expected }) => {
    expect(growHits(hits, files)).toEqual(expected)
  })
})

describe("attachAnnotationsOnly — raw mode", () => {
  const cases: {
    name: string
    hits: { file: string; id?: string; text?: string; matches?: string[] }[]
    files: Record<string, string>
    expected: { file: string; id?: string; text?: string; matches?: string[] }[]
  }[] = [
    {
      name: "uses hit.text as-is without anchor cropping",
      hits: [{ file: "doc.md", text: "raw embedding chunk text content here for indexing." }],
      files: {
        "doc.md": makeDoc("raw embedding chunk text content here for indexing.", [
          ann("embedding chunk text content"),
        ]),
      },
      expected: [
        {
          file: "doc.md",
          text: `raw embedding chunk text content here for indexing.\n\n${formatExpectedBlock([ann("embedding chunk text content")])}`,
        },
      ],
    },
    {
      name: "drops hit with no text",
      hits: [{ file: "doc.md" }],
      files: { "doc.md": "content" },
      expected: [{ file: "doc.md" }],
    },
  ]

  it.each(cases)("$name", ({ hits, files, expected }) => {
    expect(attachAnnotationsOnly(hits, files)).toEqual(expected)
  })
})

describe("refreshHits", () => {
  const cases: {
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
      name: "strips stale annotations and reattaches surviving ones",
      hits: [
        {
          file: "doc.md",
          matches: ["the relevant passage"],
          text: `the relevant passage is here.\n\n${makeAnnotations([ann("the relevant passage is here"), ann("missing annotation entirely")])}`,
        },
      ],
      files: {
        "doc.md": makeDoc("the relevant passage is here. other stuff follows.", [
          ann("the relevant passage is here"),
        ]),
      },
      expected: [
        {
          file: "doc.md",
          matches: ["the relevant passage"],
          text: `the relevant passage is here. other stuff follows.\n\n${formatExpectedBlock([ann("the relevant passage is here")])}`,
        },
      ],
    },
  ]

  it.each(cases)("$name", ({ hits, files, expected }) => {
    expect(refreshHits(hits, files)).toEqual(expected)
  })
})
