import { describe, it, expect } from "vitest"
import { normalizeValue } from "./normalize"

describe("string value normalization", () => {
  const cases: { raw: string; expected: string | null }[] = [
    { raw: "Rutte ", expected: "rutte" },
    { raw: "  RUTTE", expected: "rutte" },
    { raw: "President Rutte ", expected: "president rutte" },
    { raw: "Mark   Rutte", expected: "mark rutte" },
    { raw: '"Rutte,"', expected: "rutte" },
    { raw: "— Rutte —", expected: "rutte" },
    { raw: "   ", expected: null },
    { raw: "!!!", expected: null },
  ]

  it.each(cases)("normalizes $raw", ({ raw, expected }) => {
    expect(normalizeValue("string", raw)).toBe(expected)
  })
})

describe("datetime value normalization", () => {
  const cases: { name: string; raw: string; expected: string | null }[] = [
    { name: "a date without a time", raw: "2024-03-05", expected: "2024-03-05T00:00:00.000Z" },
    {
      name: "a date with a time",
      raw: "2024-03-05T14:30:00",
      expected: "2024-03-05T14:30:00.000Z",
    },
    {
      name: "a date with a zulu time",
      raw: "2024-03-05T14:30:00Z",
      expected: "2024-03-05T14:30:00.000Z",
    },
    {
      name: "a date with an offset",
      raw: "2024-03-05T01:30:00+02:00",
      expected: "2024-03-04T23:30:00.000Z",
    },
    {
      name: "one minute before midnight",
      raw: "2024-03-05T23:59:00",
      expected: "2024-03-05T23:59:00.000Z",
    },
    {
      name: "one minute after midnight",
      raw: "2024-03-05T00:01:00",
      expected: "2024-03-05T00:01:00.000Z",
    },
    { name: "a padded date", raw: "  2024-03-05  ", expected: "2024-03-05T00:00:00.000Z" },
    { name: "prose rather than a date", raw: "last Tuesday", expected: null },
    { name: "a year alone", raw: "2024", expected: null },
    { name: "an impossible date", raw: "2024-13-45", expected: null },
    { name: "a calendar-impossible day (Feb 30)", raw: "2024-02-30", expected: null },
    { name: "Feb 29 in a non-leap year", raw: "2023-02-29", expected: null },
    { name: "nothing at all", raw: "", expected: null },
  ]

  it.each(cases)("normalizes $name", ({ raw, expected }) => {
    expect(normalizeValue("datetime", raw)).toBe(expected)
  })
})
