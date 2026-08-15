import { describe, it, expect } from "vitest"
import { inferColumnType } from "./infer"
import type { CellType } from "./types"

describe("inferColumnType", () => {
  const cases: {
    name: string
    values: (string | undefined)[]
    expected: CellType
  }[] = [
    { name: "no values at all", values: [], expected: "text" },
    {
      name: "an all-empty column",
      values: ["", "   ", undefined, "\t"],
      expected: "text",
    },
    { name: "one of one is more than half", values: ["7"], expected: "number" },
    { name: "one date of one", values: ["2026-01-05"], expected: "date" },
    {
      name: "exactly half numbers stays text",
      values: ["1", "2", "a", "b"],
      expected: "text",
    },
    {
      name: "exactly half dates stays text",
      values: ["2026-01-05", "2026-01-06", "a", "b"],
      expected: "text",
    },
    {
      name: "three numbers and two dates of five non-empty cells",
      values: ["1", "2", "3", "2026-01-05", "2026-01-06"],
      expected: "number",
    },
    {
      name: "three dates and two numbers of five non-empty cells",
      values: ["2026-01-05", "2026-01-06", "2026-01-07", "1", "2"],
      expected: "date",
    },
    {
      name: "empties leave the denominator, so two of three numbers wins",
      values: ["1", "2", "", undefined, "   ", "x"],
      expected: "number",
    },
    {
      name: "empties cannot rescue a column that only half parses",
      values: ["1", "x", "", undefined],
      expected: "text",
    },
    {
      name: "a majority of unparseable cells stays text",
      values: ["a", "b", "c", "1", "2026-01-05"],
      expected: "text",
    },
    {
      name: "padded numbers count as numbers",
      values: [" 42 ", "\t7", "1e3"],
      expected: "number",
    },
    {
      name: "leading-zero identifiers keep the column text",
      values: ["007", "012", "042", "1"],
      expected: "text",
    },
    {
      name: "thousands separators keep the column text",
      values: ["1,000", "2,500", "3"],
      expected: "text",
    },
    {
      name: "impossible calendar dates do not count as dates",
      values: ["2026-02-30", "2026-13-01", "2026-01-05"],
      expected: "text",
    },
    {
      name: "a bare majority of numbers clears the bar",
      values: ["1", "2", "x"],
      expected: "number",
    },
    {
      name: "five of nine numbers clears the bar",
      values: ["1", "2", "3", "4", "5", "a", "b", "c", "d"],
      expected: "number",
    },
    {
      name: "four of eight numbers does not",
      values: ["1", "2", "3", "4", "a", "b", "c", "d"],
      expected: "text",
    },
  ]

  it.each(cases)("$name", ({ values, expected }) => {
    expect(inferColumnType(values)).toBe(expected)
  })
})
