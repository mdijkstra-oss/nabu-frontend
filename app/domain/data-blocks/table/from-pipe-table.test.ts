import { describe, it, expect } from "vitest"
import { pipeTableToBlock, type PipeTable } from "./from-pipe-table"
import { parseTable, type TableColumn, type TableRow } from "./schema"

describe("pipeTableToBlock", () => {
  describe("columns", () => {
    const cases: { name: string; table: PipeTable; expected: TableColumn[] }[] = [
      {
        name: "header text becomes the display name and a snake_case key",
        table: { header: ["Name", "Unit Price"], rows: [] },
        expected: [
          { key: "name", name: "Name", type: "text" },
          { key: "unit_price", name: "Unit Price", type: "text" },
        ],
      },
      {
        name: "an empty header cell gets the placeholder name column_<n>, 1-based",
        table: { header: ["", "Amount", "   "], rows: [] },
        expected: [
          { key: "column_1", name: "column_1", type: "text" },
          { key: "amount", name: "Amount", type: "text" },
          { key: "column_3", name: "column_3", type: "text" },
        ],
      },
      {
        name: "duplicate header names get distinct keys and keep both names",
        table: { header: ["Amount", "Amount", "Amount"], rows: [] },
        expected: [
          { key: "amount", name: "Amount", type: "text" },
          { key: "amount_2", name: "Amount", type: "text" },
          { key: "amount_3", name: "Amount", type: "text" },
        ],
      },
      {
        name: "a header named File is born file_2 because file is reserved",
        table: { header: ["File"], rows: [] },
        expected: [{ key: "file_2", name: "File", type: "text" }],
      },
      {
        name: "a column whose non-empty cells all parse as numbers is number",
        table: { header: ["Revenue"], rows: [["1200"], [" 950.5 "], [""]] },
        expected: [{ key: "revenue", name: "Revenue", type: "number" }],
      },
      {
        name: "a column of ISO dates is date",
        table: { header: ["Started"], rows: [["2026-01-05"], ["2026-02-11"]] },
        expected: [{ key: "started", name: "Started", type: "date" }],
      },
      {
        name: "a number column survives one non-parsing cell",
        table: { header: ["Revenue"], rows: [["1200"], ["950"], ["n/a"]] },
        expected: [{ key: "revenue", name: "Revenue", type: "number" }],
      },
      {
        // cell-types.md: more than half, and the grammars are disjoint — an even
        // split between number and date clears the bar for neither.
        name: "an even split between numbers and dates stays text",
        table: { header: ["Mixed"], rows: [["1"], ["2"], ["2026-01-05"], ["2026-02-11"]] },
        expected: [{ key: "mixed", name: "Mixed", type: "text" }],
      },
      {
        name: "a header-only table has nothing to infer from and is all text",
        table: { header: ["Revenue", "Started"], rows: [] },
        expected: [
          { key: "revenue", name: "Revenue", type: "text" },
          { key: "started", name: "Started", type: "text" },
        ],
      },
      {
        name: "inference reads only its own column",
        table: {
          header: ["Region", "Revenue"],
          rows: [
            ["North", "12"],
            ["South", "13"],
          ],
        },
        expected: [
          { key: "region", name: "Region", type: "text" },
          { key: "revenue", name: "Revenue", type: "number" },
        ],
      },
      {
        name: "padding cells of a short row never turn a column into text",
        table: { header: ["A", "Revenue"], rows: [["x", "12"], ["y"]] },
        expected: [
          { key: "a", name: "A", type: "text" },
          { key: "revenue", name: "Revenue", type: "number" },
        ],
      },
    ]

    it.each(cases)("$name", ({ table, expected }) => {
      expect(pipeTableToBlock(table).columns).toEqual(expected)
    })
  })

  describe("rows", () => {
    const cases: { name: string; table: PipeTable; expected: TableRow[] }[] = [
      {
        name: "cells are keyed by their column key",
        table: { header: ["Region", "Revenue"], rows: [["North", "1200"]] },
        expected: [{ region: "North", revenue: "1200" }],
      },
      {
        name: "a row longer than the header is truncated",
        table: { header: ["A", "B"], rows: [["1", "2", "3", "4"]] },
        expected: [{ a: "1", b: "2" }],
      },
      {
        name: "a row shorter than the header is padded with empty strings",
        table: { header: ["A", "B", "C"], rows: [["1"]] },
        expected: [{ a: "1", b: "", c: "" }],
      },
      {
        name: "an empty row squares to the full header width",
        table: { header: ["A", "B"], rows: [[]] },
        expected: [{ a: "", b: "" }],
      },
      {
        name: "a cell that fails the inferred type is preserved verbatim",
        table: { header: ["Revenue"], rows: [["1200"], ["950"], ["n/a "]] },
        expected: [{ revenue: "1200" }, { revenue: "950" }, { revenue: "n/a " }],
      },
      {
        name: "literal pipes and inline markdown source characters survive",
        table: { header: ["Note"], rows: [["a | b"], ["**bold**"], ["[x](y)"]] },
        expected: [{ note: "a | b" }, { note: "**bold**" }, { note: "[x](y)" }],
      },
      {
        name: "duplicate headers keep their cells apart",
        table: { header: ["Amount", "Amount"], rows: [["1", "2"]] },
        expected: [{ amount: "1", amount_2: "2" }],
      },
      {
        name: "a table with no body rows has no rows",
        table: { header: ["A"], rows: [] },
        expected: [],
      },
    ]

    it.each(cases)("$name", ({ table, expected }) => {
      expect(pipeTableToBlock(table).rows).toEqual(expected)
    })
  })

  describe("identity", () => {
    it("always emits a system-shaped table id rather than leaving it to the registry", () => {
      expect(pipeTableToBlock({ header: ["A"], rows: [] }).id).toMatch(/^table-[0-9][a-z0-9]*$/)
    })

    it("gives each converted table a distinct fresh id", () => {
      const first = pipeTableToBlock({ header: ["A"], rows: [] })
      const second = pipeTableToBlock({ header: ["A"], rows: [] })
      expect(first.id).not.toBe(second.id)
    })

    it("leaves the caption label empty — a gfm table carries no caption", () => {
      expect(pipeTableToBlock({ header: ["A"], rows: [["1"]] }).caption).toEqual({ label: "" })
    })

    it("emits a block the table schema accepts", () => {
      const block = pipeTableToBlock({
        header: ["Region", "", "Region"],
        rows: [["North", "1200", "2026-01-05", "dropped"], []],
      })
      expect(parseTable(JSON.stringify(block))).toEqual(block)
    })
  })
})
