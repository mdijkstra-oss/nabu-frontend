import { describe, it, expect } from "vitest"
import type { TableBlock } from "./schema"
import { tableFixture } from "./test-helpers"
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  renameColumn,
  setCell,
  setColumnType,
} from "./transforms"

const keysOf = (block: TableBlock): string[] => block.columns.map((column) => column.key)

const namesOf = (block: TableBlock): string[] => block.columns.map((column) => column.name)

const typesOf = (block: TableBlock): string[] => block.columns.map((column) => column.type)

describe("addColumn", () => {
  it("inserts at the given index and leaves the other columns in order", () => {
    const next = addColumn(tableFixture(), 1, "Category")

    expect(keysOf(next)).toEqual(["month", "category", "amount", "note"])
    expect(namesOf(next)).toEqual(["Month", "Category", "Amount", "Note"])
  })

  const keyCases: { name: string; header: string; key: string }[] = [
    { name: "a fresh name keys straight through", header: "Category", key: "category" },
    { name: "a name colliding with a column dedupes", header: "Amount ($)", key: "amount_2" },
    { name: "the reserved name is never handed out", header: "File", key: "file_2" },
    { name: "an unnameable header falls back", header: "$$$", key: "col" },
  ]

  it.each(keyCases)("$name: $header → $key", ({ header, key }) => {
    const next = addColumn(tableFixture(), 0, header)

    expect(next.columns[0].key).toBe(key)
    expect(next.columns[0].name).toBe(header)
  })

  it("appends when the index is the column count", () => {
    const next = addColumn(tableFixture(), 3, "Category")

    expect(keysOf(next)).toEqual(["month", "amount", "note", "category"])
  })

  it("is born text and adds no cell to any row", () => {
    const block = tableFixture()
    const next = addColumn(block, 1, "Category")

    expect(next.columns[1].type).toBe("text")
    expect(next.rows).toEqual(block.rows)
  })

  it("keys a second added column against the first", () => {
    const twice = addColumn(addColumn(tableFixture(), 3, "Category"), 4, "Category")

    expect(keysOf(twice)).toEqual(["month", "amount", "note", "category", "category_2"])
  })
})

describe("deleteColumn", () => {
  it("drops the column and its key from every row", () => {
    const next = deleteColumn(tableFixture(), "amount")

    expect(keysOf(next)).toEqual(["month", "note"])
    expect(next.rows).toEqual([
      { month: "2026-01-05", note: "cleaning" },
      { month: "2026-02-05", note: "" },
    ])
    for (const row of next.rows) expect("amount" in row).toBe(false)
  })

  it("deleting the last column leaves a columnless block", () => {
    const emptied = keysOf(tableFixture()).reduce(deleteColumn, tableFixture())

    expect(emptied.columns).toEqual([])
    expect(emptied.rows).toEqual([{}, {}])
  })

  it("an unknown key changes nothing", () => {
    expect(deleteColumn(tableFixture(), "nope")).toEqual(tableFixture())
  })
})

describe("renameColumn", () => {
  it("changes name only — key, type and every row stay put", () => {
    const block = tableFixture()
    const next = renameColumn(block, "amount", "Total spend")

    expect(namesOf(next)).toEqual(["Month", "Total spend", "Note"])
    expect(keysOf(next)).toEqual(keysOf(block))
    expect(typesOf(next)).toEqual(typesOf(block))
    expect(next.rows).toEqual(block.rows)
  })
})

describe("setColumnType", () => {
  it("changes type only — every cell string stays byte-identical", () => {
    const block = tableFixture()
    const next = setColumnType(block, "amount", "text")

    expect(typesOf(next)).toEqual(["date", "text", "text"])
    expect(namesOf(next)).toEqual(namesOf(block))
    expect(keysOf(next)).toEqual(keysOf(block))
    expect(next.rows).toEqual(block.rows)
  })

  it("leaves padding, leading zeros and canonical forms exactly as written", () => {
    const block: TableBlock = {
      ...tableFixture(),
      rows: [{ month: " 2026-01-05 ", amount: " 007 ", note: "  padded  " }],
    }

    const next = setColumnType(setColumnType(block, "amount", "number"), "month", "text")

    expect(next.rows).toEqual(block.rows)
    expect(next.rows[0].amount).toBe(" 007 ")
    expect(next.rows[0].month).toBe(" 2026-01-05 ")
  })

  it("re-typing a column whose cells cannot parse still keeps the cells", () => {
    const next = setColumnType(tableFixture(), "note", "number")

    expect(typesOf(next)).toEqual(["date", "number", "number"])
    expect(next.rows.map((row) => row.note)).toEqual(["cleaning", ""])
  })
})

describe("addRow", () => {
  const cases: { name: string; index: number; order: string[] }[] = [
    { name: "at the top", index: 0, order: ["", "2026-01-05", "2026-02-05"] },
    { name: "in the middle", index: 1, order: ["2026-01-05", "", "2026-02-05"] },
    { name: "at the end", index: 2, order: ["2026-01-05", "2026-02-05", ""] },
  ]

  it.each(cases)("inserts an empty row $name", ({ index, order }) => {
    const next = addRow(tableFixture(), index)

    expect(next.rows).toHaveLength(3)
    expect(next.rows.map((row) => row.month)).toEqual(order)
    expect(next.rows[index]).toEqual({ month: "", amount: "", note: "" })
  })

  it("carries one empty cell per column and no others", () => {
    const next = addRow(deleteColumn(tableFixture(), "note"), 0)

    expect(next.rows[0]).toEqual({ month: "", amount: "" })
  })
})

describe("deleteRow", () => {
  it("removes exactly the row at the index", () => {
    const block = tableFixture()
    const next = deleteRow(block, 0)

    expect(next.rows).toEqual([block.rows[1]])
    expect(next.columns).toEqual(block.columns)
  })
})

describe("setCell", () => {
  it("writes one cell and leaves the rest of the block alone", () => {
    const block = tableFixture()
    const next = setCell(block, 1, "note", "rent")

    expect(next.rows[1]).toEqual({ month: "2026-02-05", amount: "17.5", note: "rent" })
    expect(next.rows[0]).toEqual(block.rows[0])
    expect(next.columns).toEqual(block.columns)
  })

  it("writes a cell into a row that was missing the key", () => {
    const missing = deleteColumn(tableFixture(), "note")
    const next = setCell(missing, 0, "month", "2026-03-05")

    expect(next.rows[0]).toEqual({ month: "2026-03-05", amount: "42" })
  })
})

describe("every transform is block-in, block-out", () => {
  const cases: { name: string; run: (block: TableBlock) => TableBlock }[] = [
    { name: "addColumn", run: (block) => addColumn(block, 1, "Category") },
    { name: "deleteColumn", run: (block) => deleteColumn(block, "amount") },
    { name: "renameColumn", run: (block) => renameColumn(block, "amount", "Spend") },
    { name: "setColumnType", run: (block) => setColumnType(block, "amount", "text") },
    { name: "addRow", run: (block) => addRow(block, 1) },
    { name: "deleteRow", run: (block) => deleteRow(block, 0) },
    { name: "setCell", run: (block) => setCell(block, 0, "note", "changed") },
  ]

  it.each(cases)("$name mutates nothing it was handed", ({ run }) => {
    const block = tableFixture()
    run(block)

    expect(block).toEqual(tableFixture())
  })

  it.each(cases)("$name leaves id and caption alone", ({ run }) => {
    const next = run(tableFixture())

    expect(next.id).toBe(tableFixture().id)
    expect(next.caption).toEqual(tableFixture().caption)
  })
})
