import { describe, it, expect } from "vitest"
import { allValuesAreIntegers, timeAxisDomain, timeAxisTicks, wholeNumberTickCount } from "./ticks"

const utc = (iso: string): number => new Date(iso).getTime()
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

describe("timeAxisTicks", () => {
  const cases: {
    name: string
    values: (string | number)[]
    target?: number
    expected: string[]
  }[] = [
    { name: "no values", values: [], expected: [] },
    {
      name: "strings are not a time axis",
      values: ["Jan", "Feb"],
      expected: [],
    },
    {
      name: "single instant is its own tick",
      values: [utc("2024-02-01")],
      expected: ["2024-02-01"],
    },
    {
      name: "two years of months tick quarterly",
      values: [utc("2023-02-01"), utc("2024-04-01"), utc("2025-02-01")],
      expected: [
        "2023-04-01",
        "2023-07-01",
        "2023-10-01",
        "2024-01-01",
        "2024-04-01",
        "2024-07-01",
        "2024-10-01",
        "2025-01-01",
      ],
    },
    {
      name: "ticks land on boundaries the data skips",
      values: [utc("2024-01-01"), utc("2024-06-01")],
      target: 6,
      expected: [
        "2024-01-01",
        "2024-02-01",
        "2024-03-01",
        "2024-04-01",
        "2024-05-01",
        "2024-06-01",
      ],
    },
  ]

  it.each(cases)("$name", ({ values, target, expected }) => {
    expect(timeAxisTicks(values, target).map(iso)).toEqual(expected)
  })
})

describe("timeAxisDomain", () => {
  it("spans the outermost instants", () => {
    const domain = timeAxisDomain([utc("2024-06-01"), utc("2023-02-01"), utc("2025-02-01")])
    expect(domain?.map(iso)).toEqual(["2023-02-01", "2025-02-01"])
  })

  it("is absent without numeric values", () => {
    expect(timeAxisDomain(["Jan", "Feb"])).toBeUndefined()
  })
})

describe("allValuesAreIntegers", () => {
  const rows = [
    { a: 1, b: 2 },
    { a: 3, b: 4 },
  ]

  it("counts are integers", () => {
    expect(allValuesAreIntegers(rows, ["a", "b"])).toBe(true)
  })

  it("a missing key is not a fraction", () => {
    expect(allValuesAreIntegers(rows, ["a", "missing"])).toBe(true)
  })

  it("one fraction is enough", () => {
    expect(allValuesAreIntegers([...rows, { a: 1.5, b: 2 }], ["a", "b"])).toBe(false)
  })
})

describe("wholeNumberTickCount", () => {
  const cases: {
    name: string
    rows: Record<string, unknown>[]
    expected: number
  }[] = [
    { name: "no rows falls back", rows: [], expected: 5 },
    { name: "max 2 asks for three ticks", rows: [{ a: 1 }, { a: 2 }], expected: 3 },
    { name: "max 4 asks for five", rows: [{ a: 4 }], expected: 5 },
    { name: "max above the fallback keeps five", rows: [{ a: 19 }], expected: 5 },
    { name: "all zero still needs two", rows: [{ a: 0 }], expected: 2 },
  ]

  it.each(cases)("$name", ({ rows, expected }) => {
    expect(wholeNumberTickCount(rows, ["a"])).toBe(expected)
  })
})
