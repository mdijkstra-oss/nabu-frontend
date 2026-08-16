import { describe, it, expect } from "vitest"
import { formatValue } from "./format"

describe("formatValue", () => {
  const cases: {
    name: string
    value: unknown
    format: string
    expected: string
  }[] = [
    { name: "thousands separator", value: 12345, format: ",", expected: "12,345" },
    { name: "fixed decimals", value: 3.14159, format: ".2f", expected: "3.14" },
    { name: "percent zero dp", value: 0.345, format: ".0%", expected: "35%" },
    { name: "percent one dp", value: 0.3456, format: ".1%", expected: "34.6%" },
    { name: "currency", value: 1500, format: "$,.0f", expected: "$1,500" },
    { name: "numeric string passes", value: "12345", format: ",", expected: "12,345" },
    { name: "bigint coerced", value: BigInt(1000), format: ",", expected: "1,000" },
    { name: "null value", value: null, format: ",", expected: "" },
    { name: "undefined value", value: undefined, format: ",", expected: "" },
    {
      name: "time year",
      value: new Date("2024-06-15T12:00:00Z"),
      format: "%Y",
      expected: "2024",
    },
    {
      name: "time month year",
      value: "2024-06-15T12:00:00Z",
      format: "%b %Y",
      expected: "Jun 2024",
    },
    {
      name: "time from epoch",
      value: new Date("2024-06-15T12:00:00Z").getTime(),
      format: "%Y",
      expected: "2024",
    },
    {
      name: "month bucket keeps its month west of UTC",
      value: new Date("2024-02-01T00:00:00Z").getTime(),
      format: "%b %Y",
      expected: "Feb 2024",
    },
    {
      name: "day boundary keeps its day west of UTC",
      value: "2024-01-01T00:00:00Z",
      format: "%d %b %Y",
      expected: "01 Jan 2024",
    },
    { name: "invalid date", value: "not a date", format: "%Y", expected: "" },
    { name: "NaN number", value: NaN, format: ",", expected: "" },
  ]

  it.each(cases)("$name", ({ value, format, expected }) => {
    expect(formatValue(value, format)).toBe(expected)
  })
})
