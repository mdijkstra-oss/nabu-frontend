import { describe, it, expect } from "vitest"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import { migrateFile } from "~/lib/data-blocks/migrate"
import { findBlocksByLanguage } from "~/lib/data-blocks/parse"
import { parseTable, type TableBlock } from "~/domain/data-blocks/table/schema"
import { getBlockConfig } from "~/lib/data-blocks/registry"
import { pipeTableToBlock } from "~/domain/data-blocks/table/from-pipe-table"
import { migrations } from "./index"

// conversion.md:27 — "Every table gfm parses in the document ... is replaced in
// place by a `json-table` fenced block built by the shared transform". A fenced
// block the document's own reader cannot read is not that: table-block.md:9 makes
// `parseTable` over `findBlocksByLanguage` the one reader, and it is the reader
// the per-block projection uses (app/domain/db/doc-tables.ts:186) to build
// `table_<id>`. A block that fails here never reaches DuckDB and never renders.
const readConvertedBlocks = (markdown: string): (TableBlock | null)[] =>
  findBlocksByLanguage(markdown, "json-table").map((block) => parseTable(block.content))

const topLevelNodeTypes = (markdown: string): string[] =>
  unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown)
    .children.map((node) => node.type)

const quotedLines = (markdown: string): string[] =>
  markdown.split("\n").filter((line) => line.startsWith(">"))

const isQuotedTableLine = (line: string): boolean => /^[>\s]*\|/.test(line)

const quotedProseLines = (markdown: string): string[] =>
  quotedLines(markdown).filter((line) => !isQuotedTableLine(line))

describe("convert-pipe-tables — the emitted fence must be a readable block", () => {
  it("a cell holding a bare ``` fence does not cut the emitted fence short", () => {
    const { markdown } = migrateFile("| Note |\n| --- |\n| ``` |\n", migrations)

    expect(readConvertedBlocks(markdown)).toEqual([
      expect.objectContaining({ rows: [{ note: "```" }] }),
    ])
  })

  // The invariant behind every case here: whatever the migration emits, the
  // document's own reader can read back.
  it.each([
    ["a cell holding a fence", "| Note |\n| --- |\n| ``` |\n"],
    ["a table in a blockquote", "> | A |\n> | --- |\n> | 1 |\n"],
    ["a table mid-blockquote", "> Head\n>\n> | A |\n> | --- |\n> | 1 |\n>\n> Tail\n"],
    ["a table in a list item", "- Items:\n\n  | A | B |\n  | --- | --- |\n  | 1 | x |\n"],
    [
      "a table in a list item in a blockquote",
      "> - Items:\n>\n>   | A |\n>   | --- |\n>   | 1 |\n",
    ],
    ["a document opening with a BOM", "﻿| A |\n| --- |\n| 1 |\n"],
    ["prose, two tables", "Intro\n\n| A |\n| --- |\n| 1 |\n\nMid\n\n| B |\n| --- |\n| ` |\n"],
  ])("every json-table fence it emits parses back: %s", (_case, source) => {
    const { markdown } = migrateFile(source, migrations)

    expect(readConvertedBlocks(markdown)).not.toContain(null)
  })
})

// `> ` is not JSON whitespace (RFC 8259 §2) and `parseCodeBlocks` does not strip
// it (pinned by parse.test.ts), so a fence that stayed inside the quote would
// carry a payload no reader can parse. The fence is lifted to the top level and
// the quote resumes under it.
describe("convert-pipe-tables — a table inside a blockquote", () => {
  it.each([
    [
      "the quote ends at the table",
      "> Stock:\n>\n> | A |\n> | --- |\n> | 1 |\n",
      ["blockquote", "code"],
    ],
    [
      "the quote resumes after it",
      "> Stock:\n>\n> | A |\n> | --- |\n> | 1 |\n>\n> Counted Tuesday.\n",
      ["blockquote", "code", "blockquote"],
    ],
    [
      "a list item holds the table",
      "> - Stock:\n>\n>   | A |\n>   | --- |\n>   | 1 |\n>\n> Counted Tuesday.\n",
      ["blockquote", "code", "blockquote"],
    ],
  ])("converts, and the surrounding prose stays quoted — %s", (_case, source, expectedNodes) => {
    const { markdown } = migrateFile(source, migrations)

    expect(readConvertedBlocks(markdown)).toEqual([expect.objectContaining({ rows: [{ a: "1" }] })])
    expect(topLevelNodeTypes(markdown)).toEqual(expectedNodes)
    expect(quotedLines(markdown)).toEqual(quotedProseLines(source))
  })
})

// conversion.md:27 — "all other content is byte-preserved", and :21 — "Cell values
// are the cell's raw inner text". remark strips a leading BOM before parsing, so
// every mdast offset is one short of the string the migration slices.
describe("convert-pipe-tables — a UTF-8 BOM", () => {
  const BOM = "﻿"

  it("does not shift the cells the transform reads", () => {
    const { markdown } = migrateFile(`${BOM}| A |\n| --- |\n| 1 |\n`, migrations)

    expect(readConvertedBlocks(markdown)).toEqual([
      expect.objectContaining({
        columns: [{ key: "a", name: "A", type: "number" }],
        rows: [{ a: "1" }],
      }),
    ])
  })

  it("does not leave a shard of the table behind or eat a byte of the prose", () => {
    const { markdown } = migrateFile(`${BOM}Intro\n\n| A |\n| --- |\n| 1 |\n\nEnd\n`, migrations)

    expect(markdown.startsWith(`${BOM}Intro\n\n`)).toBe(true)
    expect(markdown.endsWith("```\n\nEnd\n")).toBe(true)
  })
})

// conversion.md:16 — the id is generated "using the prefix `json-table` registers".
// from-pipe-table.ts:19 hardcodes the literal instead of reading the registered
// idPaths, so nothing but this test keeps the two spellings together.
describe("convert-pipe-tables — the generated id prefix", () => {
  it("is the prefix the json-table registry entry declares", () => {
    const registered = getBlockConfig("json-table")?.idPaths?.[0]

    expect(registered).toEqual({ path: "id", prefix: expect.any(String) })
    expect(pipeTableToBlock({ header: ["A"], rows: [] }).id.split("-")[0]).toBe(registered?.prefix)
  })
})
