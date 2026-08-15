import { describe, it, expect } from "vitest"
import { parseCell, tableFailures } from "./parse"
import type { CellColumn, CellType, CellVerdict } from "./types"

const ALL_TYPES: CellType[] = ["text", "number", "date"]

describe("parseCell empty", () => {
  const blanks: { name: string; raw: string | undefined }[] = [
    { name: "missing key", raw: undefined },
    { name: "empty string", raw: "" },
    { name: "spaces only", raw: "   " },
    { name: "tabs and newlines only", raw: "\t\n " },
  ]

  const cases = ALL_TYPES.flatMap((type) =>
    blanks.map(({ name, raw }) => ({ name: `${name} in a ${type} column`, raw, type }))
  )

  it.each(cases)("$name", ({ raw, type }) => {
    expect(parseCell(raw, type)).toEqual({ kind: "empty" })
  })
})

describe("parseCell text", () => {
  const cases: { name: string; raw: string; expected: CellVerdict }[] = [
    { name: "plain word", raw: "hello", expected: { kind: "valid", value: "hello" } },
    {
      name: "padding is kept byte-for-byte",
      raw: "  padded  ",
      expected: { kind: "valid", value: "  padded  " },
    },
    { name: "digits stay a string", raw: "42", expected: { kind: "valid", value: "42" } },
    {
      name: "a string that fails every other type",
      raw: "0x10",
      expected: { kind: "valid", value: "0x10" },
    },
    {
      name: "a lone non-breaking space is content, not blank",
      raw: "\u00A0",
      expected: { kind: "valid", value: "\u00A0" },
    },
  ]

  it.each(cases)("$name", ({ raw, expected }) => {
    expect(parseCell(raw, "text")).toEqual(expected)
  })
})

describe("parseCell number", () => {
  const cases: { name: string; raw: string; expected: CellVerdict }[] = [
    { name: "exponent overflowing a double", raw: "1e309", expected: { kind: "invalid" } },
    {
      name: "negative exponent overflowing a double",
      raw: "-1e309",
      expected: { kind: "invalid" },
    },
    { name: "largest finite exponent", raw: "1e308", expected: { kind: "valid", value: 1e308 } },
    { name: "surrounding spaces trim", raw: "  42 ", expected: { kind: "valid", value: 42 } },
    { name: "surrounding tabs trim", raw: "\t7\n", expected: { kind: "valid", value: 7 } },
    { name: "interior whitespace", raw: "4 2", expected: { kind: "invalid" } },
    {
      name: "carriage return padding trims",
      raw: "\r42\r",
      expected: { kind: "valid", value: 42 },
    },
    { name: "form feed padding trims", raw: "\f42\f", expected: { kind: "valid", value: 42 } },
    { name: "vertical tab padding trims", raw: "\v42\v", expected: { kind: "valid", value: 42 } },
    { name: "non-breaking space padding", raw: "\u00A042", expected: { kind: "invalid" } },
    { name: "a lone non-breaking space", raw: "\u00A0", expected: { kind: "invalid" } },
    { name: "hex literal", raw: "0x10", expected: { kind: "invalid" } },
    { name: "leading zero", raw: "007", expected: { kind: "invalid" } },
    { name: "single leading zero", raw: "01", expected: { kind: "invalid" } },
    { name: "negative leading zero", raw: "-007", expected: { kind: "invalid" } },
    { name: "thousands separator", raw: "1,000", expected: { kind: "invalid" } },
    { name: "dotted thousands", raw: "1.000.000", expected: { kind: "invalid" } },
    { name: "leading plus", raw: "+5", expected: { kind: "invalid" } },
    { name: "Infinity word", raw: "Infinity", expected: { kind: "invalid" } },
    { name: "NaN word", raw: "NaN", expected: { kind: "invalid" } },
    { name: "underscore separator", raw: "1_000", expected: { kind: "invalid" } },
    { name: "arabic-indic digits", raw: "١٢٣", expected: { kind: "invalid" } },
    { name: "trailing letters", raw: "12abc", expected: { kind: "invalid" } },
    { name: "bare minus", raw: "-", expected: { kind: "invalid" } },
    { name: "double minus", raw: "--1", expected: { kind: "invalid" } },
    { name: "trailing dot", raw: "5.", expected: { kind: "invalid" } },
    { name: "leading dot", raw: ".5", expected: { kind: "invalid" } },
    { name: "two decimal points", raw: "1.2.3", expected: { kind: "invalid" } },
    { name: "exponent without digits", raw: "1e", expected: { kind: "invalid" } },
    { name: "exponent sign without digits", raw: "1e+", expected: { kind: "invalid" } },
    { name: "trailing decimals collapse", raw: "1.000", expected: { kind: "valid", value: 1 } },
    { name: "zero", raw: "0", expected: { kind: "valid", value: 0 } },
    { name: "negative zero", raw: "-0", expected: { kind: "valid", value: -0 } },
    { name: "negative decimal", raw: "-1.5", expected: { kind: "valid", value: -1.5 } },
    {
      name: "signed negative exponent",
      raw: "-1.5e-3",
      expected: { kind: "valid", value: -0.0015 },
    },
    { name: "capital exponent", raw: "1E3", expected: { kind: "valid", value: 1000 } },
    { name: "explicit positive exponent", raw: "1e+5", expected: { kind: "valid", value: 100000 } },
    { name: "a hyphenated date is not a number", raw: "2026-01-05", expected: { kind: "invalid" } },
  ]

  it.each(cases)("$name", ({ raw, expected }) => {
    expect(parseCell(raw, "number")).toEqual(expected)
  })
})

describe("parseCell date", () => {
  const cases: { name: string; raw: string; expected: CellVerdict }[] = [
    { name: "month and day out of range", raw: "2026-13-45", expected: { kind: "invalid" } },
    { name: "month zero", raw: "2026-00-10", expected: { kind: "invalid" } },
    { name: "february thirtieth", raw: "2026-02-30", expected: { kind: "invalid" } },
    {
      name: "february twenty-ninth in a common year",
      raw: "2026-02-29",
      expected: { kind: "invalid" },
    },
    {
      name: "february twenty-ninth in a leap year",
      raw: "2024-02-29",
      expected: { kind: "valid", value: "2024-02-29" },
    },
    {
      name: "february twenty-ninth in a 400-divisible year",
      raw: "2000-02-29",
      expected: { kind: "valid", value: "2000-02-29" },
    },
    {
      name: "february twenty-ninth in a 100-divisible year",
      raw: "1900-02-29",
      expected: { kind: "invalid" },
    },
    {
      name: "thirty-first of a thirty-day month",
      raw: "2026-04-31",
      expected: { kind: "invalid" },
    },
    {
      name: "thirtieth of a thirty-day month",
      raw: "2026-04-30",
      expected: { kind: "valid", value: "2026-04-30" },
    },
    { name: "day zero", raw: "2026-01-00", expected: { kind: "invalid" } },
    { name: "day thirty-two", raw: "2026-01-32", expected: { kind: "invalid" } },
    {
      name: "last day of the year",
      raw: "2026-12-31",
      expected: { kind: "valid", value: "2026-12-31" },
    },
    { name: "unpadded month and day", raw: "2026-1-5", expected: { kind: "invalid" } },
    { name: "unpadded day", raw: "2026-01-5", expected: { kind: "invalid" } },
    { name: "two-digit year", raw: "26-01-05", expected: { kind: "invalid" } },
    { name: "five-digit year", raw: "02026-01-05", expected: { kind: "invalid" } },
    { name: "slash form", raw: "2026/01/05", expected: { kind: "invalid" } },
    { name: "slash after the year only", raw: "2026/01-05", expected: { kind: "invalid" } },
    { name: "slash before the day only", raw: "2026-01/05", expected: { kind: "invalid" } },
    { name: "ambiguous slash ordering", raw: "12/03/2026", expected: { kind: "invalid" } },
    { name: "time suffix", raw: "2026-01-01T10:00", expected: { kind: "invalid" } },
    { name: "zulu suffix", raw: "2026-01-05Z", expected: { kind: "invalid" } },
    { name: "leading minus", raw: "-2026-01-05", expected: { kind: "invalid" } },
    { name: "a number is not a date", raw: "42", expected: { kind: "invalid" } },
    {
      name: "surrounding whitespace trims to the canonical string",
      raw: "  2026-01-05\t",
      expected: { kind: "valid", value: "2026-01-05" },
    },
    {
      name: "carriage return, form feed and vertical tab padding trims",
      raw: "\r\f\v2026-01-05\v\f\r",
      expected: { kind: "valid", value: "2026-01-05" },
    },
    { name: "a lone non-breaking space", raw: "\u00A0", expected: { kind: "invalid" } },
  ]

  it.each(cases)("$name", ({ raw, expected }) => {
    expect(parseCell(raw, "date")).toEqual(expected)
  })

  // Every month's boundary, both sides: without all twelve a wrong entry in the
  // length table only shows up in the four months nothing else covers.
  const lastDays = [
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
    "2026-05-31",
    "2026-06-30",
    "2026-07-31",
    "2026-08-31",
    "2026-09-30",
    "2026-10-31",
    "2026-11-30",
    "2026-12-31",
    "2024-02-29",
    "2024-12-31",
  ]

  it.each(lastDays)("%s is the last valid day of its month", (raw) => {
    expect(parseCell(raw, "date")).toEqual({ kind: "valid", value: raw })
  })

  const overflowDays = [
    "2026-01-32",
    "2026-02-29",
    "2026-03-32",
    "2026-04-31",
    "2026-05-32",
    "2026-06-31",
    "2026-07-32",
    "2026-08-32",
    "2026-09-31",
    "2026-10-32",
    "2026-11-31",
    "2026-12-32",
    "2024-02-30",
    "2024-12-32",
  ]

  it.each(overflowDays)("%s is one day past its month", (raw) => {
    expect(parseCell(raw, "date")).toEqual({ kind: "invalid" })
  })

  it("returns the canonical string, never a Date", () => {
    const verdict = parseCell("2026-01-05", "date")
    expect(verdict).toEqual({ kind: "valid", value: "2026-01-05" })
    expect(verdict.kind === "valid" && typeof verdict.value).toBe("string")
  })
})

describe("tableFailures", () => {
  const columns: CellColumn[] = [
    { key: "name", type: "text" },
    { key: "amount", type: "number" },
    { key: "due", type: "date" },
  ]

  const cases: {
    name: string
    columns: CellColumn[]
    rows: Record<string, string>[]
    expected: { row: number; column: string }[]
  }[] = [
    {
      name: "two invalid cells among empty ones, in table order",
      columns,
      rows: [
        { name: "rent", amount: "1,000", due: "2026-01-05" },
        { name: "food", amount: "", due: "   " },
        { name: "", amount: "42", due: "2026-02-30" },
      ],
      expected: [
        { row: 0, column: "amount" },
        { row: 2, column: "due" },
      ],
    },
    {
      name: "an all-valid table has no failures",
      columns,
      rows: [{ name: "rent", amount: "42", due: "2026-01-05" }],
      expected: [],
    },
    {
      name: "missing keys are empty, not invalid",
      columns,
      rows: [{ name: "rent" }],
      expected: [],
    },
    { name: "no rows", columns, rows: [], expected: [] },
    { name: "no columns", columns: [], rows: [{ amount: "nope" }], expected: [] },
    {
      name: "keys outside the columns are ignored",
      columns,
      rows: [{ name: "rent", amount: "42", due: "2026-01-05", stray: "0x10" }],
      expected: [],
    },
    {
      name: "row-major order across several failures in one row",
      columns,
      rows: [
        { name: "a", amount: "x", due: "y" },
        { name: "b", amount: "z", due: "2026-01-05" },
      ],
      expected: [
        { row: 0, column: "amount" },
        { row: 0, column: "due" },
        { row: 1, column: "amount" },
      ],
    },
    {
      name: "text cells are never invalid",
      columns,
      rows: [{ name: "  anything at all  ", amount: "1", due: "2026-01-05" }],
      expected: [],
    },
  ]

  it.each(cases)("$name", ({ columns: cols, rows, expected }) => {
    expect(tableFailures(cols, rows)).toEqual(expected)
  })

  // `constructor` clears the block schema's column-key pattern, so a header named
  // "Constructor" reaches here as a column key; a row that never got that cell
  // then resolves it off Object.prototype instead of being missing.
  const inheritedKeys: { name: string; key: string; type: CellType }[] = [
    { name: "constructor", key: "constructor", type: "number" },
    { name: "toString", key: "toString", type: "number" },
    { name: "valueOf", key: "valueOf", type: "date" },
    { name: "hasOwnProperty", key: "hasOwnProperty", type: "text" },
    { name: "__proto__", key: "__proto__", type: "text" },
  ]

  it.each(inheritedKeys)(
    "a column keyed $name is empty in a row that lacks it, not inherited",
    ({ key, type }) => {
      expect(tableFailures([{ key, type }], [{}])).toEqual([])
    }
  )

  it("keeps summarizing the other columns when one is keyed constructor", () => {
    const cols: CellColumn[] = [
      { key: "amount", type: "number" },
      { key: "constructor", type: "number" },
    ]
    expect(tableFailures(cols, [{ amount: "1,000" }])).toEqual([{ row: 0, column: "amount" }])
  })
})
