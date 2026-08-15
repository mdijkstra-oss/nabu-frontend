import { describe, it, expect, vi, beforeEach } from "vitest"
import { tableFailures } from "~/lib/cells/parse"
import type * as CellParse from "~/lib/cells/parse"
import {
  getBlockConfig,
  getBlockSchemaDefinitions,
  resolveBlockLabel,
} from "~/lib/data-blocks/registry"
import { fillMissingIds } from "~/lib/data-blocks/uuid"
import { validateBlocksAsync, validateSemantic } from "~/lib/data-blocks/validate"
import type { ValidationError } from "~/lib/data-blocks/validate"
import { jsonTable } from "./definition"
import { generateColumnKey } from "./keys"
import { TableSchema, parseTable, type TableBlock } from "./schema"
import { dirtyTableFixture, tableFixture } from "./test-helpers"

vi.mock("~/lib/cells/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof CellParse>()
  return { ...actual, tableFailures: vi.fn(actual.tableFailures) }
})

const failures = vi.mocked(tableFailures)

const tableObject = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "table-001",
  caption: { label: "Demo" },
  columns: [{ key: "amount", name: "Amount", type: "number" }],
  rows: [{ amount: "42" }],
  ...overrides,
})

const tableJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify(tableObject(overrides))

const tableFence = (overrides: Record<string, unknown> = {}): string =>
  ["```json-table", JSON.stringify(tableObject(overrides), null, "\t"), "```"].join("\n")

const issueMessages = (value: unknown): string[] => {
  const result = TableSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

const issuePaths = (value: unknown): string[] => {
  const result = TableSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."))
}

const asyncValidate = async (block: TableBlock): Promise<ValidationError[]> => {
  const validate = jsonTable.asyncValidate
  if (!validate) throw new Error("json-table declares no asyncValidate")
  return validate(block, {})
}

beforeEach(() => {
  failures.mockClear()
})

describe("parseTable — hostile content", () => {
  const cases: { name: string; content: string }[] = [
    { name: "not JSON", content: "not json at all" },
    { name: "JSON string", content: '"just a string"' },
    { name: "JSON number", content: "42" },
    { name: "JSON array", content: "[1, 2, 3]" },
    { name: "JSON null", content: "null" },
    { name: "JSON true", content: "true" },
    { name: "empty content", content: "" },
    { name: "truncated JSON", content: '{"id": "table-1", "columns": [' },
    {
      name: "object missing columns",
      content: JSON.stringify({ id: "table-1", caption: { label: "x" }, rows: [] }),
    },
    {
      name: "object missing rows",
      content: JSON.stringify({ id: "table-1", caption: { label: "x" }, columns: [] }),
    },
    {
      name: "object missing caption",
      content: JSON.stringify({ id: "table-1", columns: [], rows: [] }),
    },
    { name: "columns as an object", content: tableJson({ columns: {} }) },
    { name: "rows as an object", content: tableJson({ rows: {} }) },
  ]

  it.each(cases)("$name → null, never throws", ({ content }) => {
    expect(() => parseTable(content)).not.toThrow()
    expect(parseTable(content)).toBeNull()
  })
})

describe("parseTable — the shape that lives", () => {
  it("returns the typed block", () => {
    const block = parseTable(tableJson())

    expect(block).toEqual(tableObject())
    expect(block?.columns[0].key).toBe("amount")
  })

  const accepted: { name: string; overrides: Record<string, unknown> }[] = [
    { name: "no columns — the grid deleted the last one", overrides: { columns: [], rows: [] } },
    { name: "no rows", overrides: { rows: [] } },
    { name: "no columns but rows still carrying keys", overrides: { columns: [] } },
    { name: "a row missing a declared key — a NULL cell", overrides: { rows: [{}] } },
    { name: "a row carrying a key no column declares", overrides: { rows: [{ nope: "x" }] } },
    { name: "an empty cell string", overrides: { rows: [{ amount: "" }] } },
    { name: "a cell that cannot parse under its type", overrides: { rows: [{ amount: "soon" }] } },
    { name: "an empty caption label", overrides: { caption: { label: "" } } },
    {
      name: "every column type",
      overrides: {
        columns: [
          { key: "a", name: "A", type: "text" },
          { key: "b", name: "B", type: "number" },
          { key: "c", name: "C", type: "date" },
        ],
        rows: [],
      },
    },
  ]

  it.each(accepted)("accepts $name", ({ overrides }) => {
    expect(parseTable(tableJson(overrides))).not.toBeNull()
  })

  it("accepts the shared fixture", () => {
    expect(TableSchema.safeParse(tableFixture()).success).toBe(true)
  })
})

describe("column keys — the SQL identifier", () => {
  const column = (key: string): Record<string, unknown> => ({
    columns: [{ key, name: "Label", type: "text" }],
    rows: [],
  })

  const cases: { key: string; valid: boolean }[] = [
    { key: "unit_price", valid: true },
    { key: "col_2024", valid: true },
    { key: "a", valid: true },
    { key: "amount2", valid: true },
    { key: "unitPrice", valid: false },
    { key: "2col", valid: false },
    { key: "has-hyphen", valid: false },
    { key: "has space", valid: false },
    { key: "", valid: false },
    { key: "_leading", valid: false },
    { key: "Amount", valid: false },
    { key: "amount!", valid: false },
    { key: "amount ", valid: false },
  ]

  it.each(cases)('"$key" → valid: $valid', ({ key, valid }) => {
    expect(parseTable(tableJson(column(key))) !== null).toBe(valid)
  })

  it("names the pattern when a key does not match", () => {
    expect(issueMessages(tableObject(column("unitPrice"))).join(" ")).toMatch(
      /lowercase|snake_case|\^\[a-z\]/i
    )
  })
})

describe("column keys — the two schema-level refinements", () => {
  const duplicated = {
    columns: [
      { key: "amount", name: "Amount", type: "number" },
      { key: "amount", name: "Amount again", type: "text" },
    ],
    rows: [],
  }

  it("rejects two columns sharing one SQL name", () => {
    expect(parseTable(tableJson(duplicated))).toBeNull()
  })

  it("names the duplicated key and points at the second column", () => {
    expect(issueMessages(tableObject(duplicated)).join(" ")).toMatch(/duplicate/i)
    expect(issueMessages(tableObject(duplicated)).join(" ")).toContain("amount")
    expect(issuePaths(tableObject(duplicated))).toContain("columns.1.key")
  })

  it("accepts distinct keys that merely share a display name", () => {
    const block = parseTable(
      tableJson({
        columns: [
          { key: "amount", name: "Amount", type: "number" },
          { key: "amount_2", name: "Amount", type: "number" },
        ],
        rows: [],
      })
    )

    expect(block).not.toBeNull()
  })

  const reserved = {
    columns: [{ key: "file", name: "File", type: "text" }],
    rows: [],
  }

  it("rejects a column keyed file", () => {
    expect(parseTable(tableJson(reserved))).toBeNull()
  })

  it("names the reservation", () => {
    const message = issueMessages(tableObject(reserved)).join(" ")

    expect(message).toMatch(/reserved/i)
    expect(message).toContain("file")
    expect(issuePaths(tableObject(reserved))).toContain("columns.0.key")
  })

  it("leaves keys that merely start with file alone", () => {
    expect(
      parseTable(tableJson({ columns: [{ key: "file_2", name: "File", type: "text" }], rows: [] }))
    ).not.toBeNull()
  })
})

describe("column keys that shadow Object.prototype", () => {
  // cell-types.md:20 — "Non-string cell values never reach this module; the
  // block schema in table-block.md guards that boundary." `constructor` matches
  // the key pattern, so a row that omits it resolves `row.constructor` to the
  // Object function off the prototype chain.
  const shadowing = {
    columns: [{ key: "constructor", name: "Constructor", type: "text" }],
    rows: [{}],
  }

  it("rejects a column key that resolves off Object.prototype", () => {
    expect(parseTable(tableJson(shadowing))).toBeNull()
  })

  it("never crashes the agent's validation loop", async () => {
    await expect(validateBlocksAsync(tableFence(shadowing), {})).resolves.toBeDefined()
  })

  it("never generates a key its own schema would reject", () => {
    const names = ["Constructor", "File", "2024", "$$$", "unitPrice", "Amount ($)"]

    for (const name of names) {
      const key = generateColumnKey(name, [])

      expect(
        parseTable(tableJson({ columns: [{ key, name, type: "text" }], rows: [] }))
      ).not.toBeNull()
    }
  })
})

describe("a __proto__ row key", () => {
  // zod assigns the record through the prototype setter, so the key vanishes
  // rather than becoming the stray-key error table-block.md:17 describes. It
  // costs nothing: the key pattern forbids a leading underscore, so no column
  // can ever be keyed `__proto__` and no cell can ever have lived under it.
  const withProtoKey = [
    '{"id":"table-001","caption":{"label":"Demo"},',
    '"columns":[{"key":"amount","name":"Amount","type":"number"}],',
    '"rows":[{"__proto__":"x","amount":"42"}]}',
  ].join("")

  it("is dropped, and pollutes nothing", () => {
    const block = parseTable(withProtoKey)

    expect(block?.rows[0]).toEqual({ amount: "42" })
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it("could never have named a column", () => {
    expect(
      parseTable(tableJson({ columns: [{ key: "__proto__", name: "P", type: "text" }], rows: [] }))
    ).toBeNull()
  })
})

describe("column name and type", () => {
  const cases: { name: string; column: Record<string, unknown>; valid: boolean }[] = [
    { name: "a plain name", column: { key: "a", name: "Amount ($)", type: "text" }, valid: true },
    { name: "an empty name", column: { key: "a", name: "", type: "text" }, valid: false },
    { name: "a missing name", column: { key: "a", type: "text" }, valid: false },
    { name: "a non-string name", column: { key: "a", name: 42, type: "text" }, valid: false },
    { name: "a missing type", column: { key: "a", name: "A" }, valid: false },
    {
      name: "datetime — deferred",
      column: { key: "a", name: "A", type: "datetime" },
      valid: false,
    },
    { name: "an unknown type", column: { key: "a", name: "A", type: "money" }, valid: false },
    { name: "a missing key", column: { name: "A", type: "text" }, valid: false },
  ]

  it.each(cases)("$name → valid: $valid", ({ column, valid }) => {
    expect(parseTable(tableJson({ columns: [column], rows: [] })) !== null).toBe(valid)
  })
})

describe("row values are JSON strings, never coerced", () => {
  const cases: { name: string; value: unknown }[] = [
    { name: "a number", value: 42 },
    { name: "a boolean", value: true },
    { name: "null", value: null },
    { name: "an object", value: { nested: "no" } },
    { name: "an array", value: ["42"] },
  ]

  it.each(cases)("$name in a cell → rejected", ({ value }) => {
    expect(parseTable(tableJson({ rows: [{ amount: value }] }))).toBeNull()
  })

  it("rejects a row that is not an object", () => {
    expect(parseTable(tableJson({ rows: ["42"] }))).toBeNull()
  })

  it("keeps a numeric cell as its string", () => {
    const block = parseTable(tableJson({ rows: [{ amount: "0042" }] }))

    expect(block?.rows[0].amount).toBe("0042")
  })
})

describe("json-table in the agent's schema listing", () => {
  const definition = () =>
    getBlockSchemaDefinitions().find((entry) => entry.language === "json-table")

  it("is listed with its immutable id and no singleton flag", () => {
    expect(definition()?.singleton).toBe(false)
    expect(definition()?.immutable).toContain("id")
  })

  const sentences: { name: string; pattern: RegExp }[] = [
    { name: "rename changes name, never key", pattern: /rename[\s\S]*\bname\b[\s\S]*\bkey\b/i },
    { name: "delete removes the key from every row", pattern: /delete[\s\S]*from every row/i },
    { name: "a new key is generated and never changes", pattern: /snake_case[\s\S]*generated/i },
    { name: "file is reserved", pattern: /`file` is reserved/i },
    { name: "every cell value is a JSON string", pattern: /JSON string[\s\S]*"42"/i },
    { name: "a missing key is a NULL cell", pattern: /missing from a row is a NULL cell/i },
    { name: "each table is queryable as table_<id>", pattern: /table_<id>/ },
  ]

  it.each(sentences)("carries the constraint: $name", ({ pattern }) => {
    expect((definition()?.constraints ?? []).join("\n")).toMatch(pattern)
  })

  it("carries the five constraint sentences", () => {
    expect(definition()?.constraints).toHaveLength(5)
  })
})

// table-block.md:83 — the skeleton's middle joint: the block parses through the
// real registry, fillMissingIds stamps it a `table-` id, and the caption
// machinery reads its label.
describe("json-table through the real registry machinery", () => {
  it("resolves TableSchema through getBlockConfig", () => {
    expect(getBlockConfig("json-table")?.schema()).toBe(TableSchema)
  })

  const idless = [
    "```json-table",
    JSON.stringify({ caption: { label: "Demo" }, columns: [], rows: [] }),
    "```",
  ].join("\n")

  it("stamps a missing id with the table- prefix", () => {
    const { content, generated } = fillMissingIds(idless)

    expect(generated.map((entry) => entry.id)).toEqual([expect.stringMatching(/^table-/)])
    expect(content).toContain(generated[0].id)
  })

  it("reads the caption label as the block's name and numbers it as a Table", () => {
    expect(fillMissingIds(idless).generated[0].label).toBe("Demo")
    expect(resolveBlockLabel("json-table", tableObject())).toBe("Demo")
    expect(getBlockConfig("json-table")?.captionType).toBe("Table")
  })
})

describe("asyncValidate — row/column agreement", () => {
  const withStray = (): TableBlock => {
    const block = tableFixture()
    return { ...block, rows: [{ ...block.rows[0], bogus: "x" }, block.rows[1]] }
  }

  it("errors once per stray key, addressed at the cell", async () => {
    const errors = await asyncValidate(withStray())

    expect(errors).toHaveLength(1)
    expect(errors[0].block).toBe("json-table")
    expect(errors[0].field).toBe("rows.0.bogus")
  })

  it("names the unknown key and lists the known ones", async () => {
    const [error] = await asyncValidate(withStray())

    expect(error.message).toContain("bogus")
    for (const key of ["month", "amount", "note"]) expect(error.message).toContain(key)
  })

  it("addresses each stray key in its own row", async () => {
    const block = tableFixture()
    const strayed: TableBlock = {
      ...block,
      rows: [
        { ...block.rows[0], bogus: "x" },
        { ...block.rows[1], other: "y" },
      ],
    }

    const errors = await asyncValidate(strayed)

    expect(errors.map((error) => error.field)).toEqual(["rows.0.bogus", "rows.1.other"])
  })

  it("says nothing about a key a row simply omits", async () => {
    const block = tableFixture()
    const sparse: TableBlock = { ...block, rows: [{ month: "2026-01-05" }] }

    expect(await asyncValidate(sparse)).toEqual([])
  })

  it("flags every key when the block declares no columns", async () => {
    const block = tableFixture()
    const columnless: TableBlock = { ...block, columns: [], rows: [{ amount: "42" }] }

    const errors = await asyncValidate(columnless)

    expect(errors.map((error) => error.field)).toEqual(["rows.0.amount"])
  })

  it("errors once per key of a columnless block and says there are none to name", async () => {
    const block = tableFixture()
    const columnless: TableBlock = { ...block, columns: [], rows: [{ a: "1", b: "2" }] }

    const errors = await asyncValidate(columnless)

    expect(errors.map((error) => error.field)).toEqual(["rows.0.a", "rows.0.b"])
    expect(errors[0].message).toMatch(/none/i)
  })

  it("hands the agent the value it wrote under the stray key", async () => {
    const [error] = await asyncValidate(withStray())

    expect(error.received).toBe('"x"')
  })
})

describe("asyncValidate — cells that fail their column's type", () => {
  it("turns each failure entry into an error naming that exact cell", async () => {
    failures.mockReturnValueOnce([
      { row: 0, column: "amount" },
      { row: 1, column: "month" },
    ])

    const errors = await asyncValidate(tableFixture())

    expect(errors.map((error) => error.field)).toEqual(["rows.0.amount", "rows.1.month"])
    expect(errors.every((error) => error.block === "json-table")).toBe(true)
  })

  it("names the column's declared type in the message", async () => {
    failures.mockReturnValueOnce([{ row: 0, column: "month" }])

    const [error] = await asyncValidate(tableFixture())

    expect(error.message).toContain("date")
  })

  it("hands the agent the cell value that would not parse", async () => {
    failures.mockReturnValueOnce([{ row: 1, column: "amount" }])

    const [error] = await asyncValidate(tableFixture())

    expect(error.received).toBe('"17.5"')
  })

  it("produces no error for an empty failure list", async () => {
    failures.mockReturnValueOnce([])

    expect(await asyncValidate(tableFixture())).toEqual([])
  })

  it("hands the block's own columns and rows to the cell contract", async () => {
    const block = tableFixture()
    await asyncValidate(block)

    expect(failures).toHaveBeenCalledWith(block.columns, block.rows)
  })

  it("finds a genuinely unparseable cell without the fake", async () => {
    const errors = await asyncValidate(dirtyTableFixture())

    expect(errors.map((error) => error.field)).toEqual(["rows.0.amount"])
    expect(errors[0].received).toBe('"about forty"')
  })

  it("a minimal valid block validates clean", async () => {
    const minimal: TableBlock = {
      id: "table-min",
      caption: { label: "Minimal" },
      columns: [{ key: "note", name: "Note", type: "text" }],
      rows: [{}],
    }

    expect(TableSchema.safeParse(minimal).success).toBe(true)
    expect(await asyncValidate(minimal)).toEqual([])
  })
})

describe("the errors reach the agent through the existing validation loop", () => {
  it("carries a failing cell out of validateBlocksAsync", async () => {
    failures.mockReturnValueOnce([{ row: 0, column: "amount" }])

    const result = await validateBlocksAsync(tableFence(), {})

    expect(result.valid).toBe(false)
    expect(result.errors[0].field).toBe("rows.0.amount")
  })

  it("carries a stray row key out of validateBlocksAsync", async () => {
    const result = await validateBlocksAsync(tableFence({ rows: [{ nope: "x" }] }), {})

    expect(result.valid).toBe(false)
    expect(result.errors.map((error) => error.field)).toEqual(["rows.0.nope"])
  })

  it("passes a clean block", async () => {
    expect((await validateBlocksAsync(tableFence(), {})).valid).toBe(true)
  })

  it("rejects an edit that changes the block id", () => {
    const result = validateSemantic(tableFence({ id: "table-002" }), {
      original: tableFence(),
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.field === "id")).toBe(true)
  })
})
