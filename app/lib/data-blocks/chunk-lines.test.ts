import { describe, expect, it } from "vitest"
import { block } from "./test-helpers"
import { chunkLines, extractLines, type LineChunk } from "./chunk-lines"

describe("chunkLines", () => {
  interface Case {
    name: string
    content: string
    targetSize: number
    expected: LineChunk[]
  }

  const cases: Case[] = [
    {
      name: "empty content",
      content: "",
      targetSize: 100,
      expected: [],
    },
    {
      name: "whitespace only",
      content: "   \n  \n  ",
      targetSize: 100,
      expected: [],
    },
    {
      name: "single line under target",
      content: "hello world",
      targetSize: 100,
      expected: [{ startLine: 1, endLine: 1 }],
    },
    {
      name: "single line exceeding target — one chunk anyway",
      content: "a".repeat(200),
      targetSize: 50,
      expected: [{ startLine: 1, endLine: 1 }],
    },
    {
      name: "two lines, both under target",
      content: "hello\nworld",
      targetSize: 100,
      expected: [{ startLine: 1, endLine: 2 }],
    },
    {
      name: "splits when prose exceeds target",
      content: "aaaa\nbbbb\ncccc\ndddd",
      targetSize: 8,
      expected: [
        { startLine: 1, endLine: 2 },
        { startLine: 3, endLine: 4 },
      ],
    },
    {
      name: "heading does not cause early flush",
      content: "intro\nsome text\n# Section B\nmore text",
      targetSize: 20,
      expected: [{ startLine: 1, endLine: 4 }],
    },
    {
      name: "heading included in chunk under target",
      content: "# Title\nsome text\nmore",
      targetSize: 1000,
      expected: [{ startLine: 1, endLine: 3 }],
    },
    {
      name: "headings do not split — only target size does",
      content: "# A\ntext a\n# B\ntext b\n# C\ntext c",
      targetSize: 10,
      expected: [
        { startLine: 1, endLine: 3 },
        { startLine: 4, endLine: 6 },
      ],
    },
    {
      name: "code block lines do not count toward size",
      content: `short\n${block("json-callout", '{"id":"c1","title":"Week 1"}')}\nend`,
      targetSize: 10,
      expected: [{ startLine: 1, endLine: 5 }],
    },
    {
      name: "code block rides along with preceding prose",
      content: `aaaa\nbbbb\n${block("json-chart", '{"id":"ch1"}')}\ncccc\ndddd\neeee`,
      targetSize: 9,
      expected: [
        { startLine: 1, endLine: 6 },
        { startLine: 7, endLine: 8 },
      ],
    },
    {
      name: "heading after code block does not flush",
      content: `intro\n${block("json-callout", '{"id":"c1","title":"X"}')}\n# Next\nbody`,
      targetSize: 20,
      expected: [{ startLine: 1, endLine: 6 }],
    },
    {
      name: "entire file is a code block — one chunk",
      content: block("json-attributes", '{"type":"t","subject":"s"}'),
      targetSize: 10,
      expected: [{ startLine: 1, endLine: 3 }],
    },
    {
      name: "multiple code blocks between prose",
      content: `aa\n${block("json-callout", '{"id":"c1","title":"A"}')}\nbb\n${block("json-chart", '{"id":"ch1"}')}\ncc`,
      targetSize: 4,
      expected: [
        { startLine: 1, endLine: 5 },
        { startLine: 6, endLine: 9 },
      ],
    },
    {
      name: "singleton and non-singleton treated equally by chunker",
      content: `prose\n${block("json-attributes", '{"type":"t"}')}\nmore prose`,
      targetSize: 1000,
      expected: [{ startLine: 1, endLine: 5 }],
    },
    {
      name: "tiny tail merges into previous chunk",
      content: "aaaa\nbbbb\nab",
      targetSize: 8,
      expected: [{ startLine: 1, endLine: 3 }],
    },
    {
      name: "tail at exactly half does not merge",
      content: "aaaa\nbbbb\ncccc",
      targetSize: 8,
      expected: [
        { startLine: 1, endLine: 2 },
        { startLine: 3, endLine: 3 },
      ],
    },
  ]

  it.each(cases)("$name", (c) => {
    expect(chunkLines(c.content, c.targetSize)).toEqual(c.expected)
  })
})

describe("chunkLines + extractLines integration", () => {
  const doc = [
    "# Introduction",
    "This is a research document about qualitative methods.",
    "It covers several important topics across multiple sections.",
    "",
    block("json-attributes", '{"type":"research","subject":"qualitative methods"}'),
    "",
    "Qualitative research is a broad field of inquiry that uses unstructured data.",
    "The goal is to understand social phenomena from the perspective of participants.",
    "Methods include interviews, focus groups, and document analysis.",
    "Each method has its own strengths and limitations that researchers must consider.",
    "",
    "# Methods",
    "## Interviews",
    "Interviews are one-on-one conversations between researcher and participant.",
    "They can be structured, semi-structured, or unstructured.",
    "The choice depends on the research question and available resources.",
    "",
    block(
      "json-callout",
      '{"id":"c1","title":"Interview Types","content":"Three main forms exist."}'
    ),
    "",
    "Semi-structured interviews use a topic guide but allow flexibility.",
    "The interviewer can probe deeper into interesting responses.",
    "This makes them particularly useful for exploratory research.",
    "",
    block("json-chart", '{"id":"ch1","caption":{"label":"Interview Duration Distribution"}}'),
    "",
    "## Focus Groups",
    "Focus groups bring together 6-10 participants for guided discussion.",
    "The moderator facilitates conversation around predetermined topics.",
    "Group dynamics can reveal insights that individual interviews miss.",
    "Participants may build on each other's ideas and challenge assumptions.",
    "",
    block(
      "json-annotations",
      '[{"id":"a1","text":"key finding","start":5,"end":20,"color":"yellow"}]'
    ),
    "",
    "# Analysis",
    "Thematic analysis is the most common approach to qualitative data.",
    "It involves identifying patterns and themes across the dataset.",
    "Researchers code data iteratively, moving between data and theory.",
    "The process is not linear but recursive and reflexive.",
    "",
    "Coding begins with familiarization — reading and re-reading transcripts.",
    "Initial codes are generated from interesting features of the data.",
    "These codes are then grouped into broader themes.",
    "Themes are reviewed, refined, and named before final write-up.",
    "",
    block("json-chart", '{"id":"ch2","caption":{"label":"Coding Process"}}'),
    "",
    "# Discussion",
    "The findings suggest that combining methods yields richer insights.",
    "Triangulation strengthens the credibility of qualitative research.",
    "However, practical constraints often limit what is feasible.",
    "Researchers must balance rigor with available time and resources.",
    "",
    "Future work should explore how digital tools can support analysis.",
    "AI-assisted coding shows promise but raises questions about validity.",
    "The role of the researcher as interpretive instrument remains central.",
    "No technology can replace the nuanced understanding a skilled researcher brings.",
  ].join("\n")

  const TARGET = 400
  const chunks = chunkLines(doc, TARGET)
  const lines = doc.split("\n")

  it("produces multiple chunks", () => {
    expect(chunks.length).toBeGreaterThan(1)
  })

  it("first chunk starts at line 1", () => {
    expect(chunks[0].startLine).toBe(1)
  })

  it("last chunk ends at last line", () => {
    expect(chunks[chunks.length - 1].endLine).toBe(lines.length)
  })

  it("chunks are contiguous with no gaps or overlaps", () => {
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startLine).toBe(chunks[i - 1].endLine + 1)
    }
  })

  it("extractLines for each chunk matches original lines", () => {
    for (const chunk of chunks) {
      const extracted = extractLines(doc, chunk.startLine, chunk.endLine)
      const expected = lines.slice(chunk.startLine - 1, chunk.endLine).join("\n")
      expect(extracted).toBe(expected)
    }
  })

  it("reassembling all chunks produces the original document", () => {
    const reassembled = chunks.map((c) => extractLines(doc, c.startLine, c.endLine)).join("\n")
    expect(reassembled).toBe(doc)
  })
})
