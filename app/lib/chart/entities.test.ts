import { describe, it, expect } from "vitest"
import { extractEntityIdsFromRows, extractEntityIdsFromText } from "./entities"

describe("extractEntityIdsFromRows", () => {
  const prefixes = ["annotation", "callout", "tag", "search"]

  const cases: {
    name: string
    rows: Record<string, unknown>[]
    prefixes: string[]
    expected: string[]
  }[] = [
    {
      name: "extracts entity IDs from string values",
      rows: [
        { id: "annotation-1abc2def", code: "Trust", count: 5 },
        { id: "annotation-2xyz3ghi", code: "Empathy", count: 3 },
      ],
      prefixes,
      expected: ["annotation-1abc2def", "annotation-2xyz3ghi"],
    },
    {
      name: "deduplicates across rows",
      rows: [
        { id: "annotation-1abc2def", count: 5 },
        { id: "annotation-1abc2def", count: 3 },
      ],
      prefixes,
      expected: ["annotation-1abc2def"],
    },
    {
      name: "ignores non-string values",
      rows: [{ id: 42, flag: true, nothing: null }],
      prefixes,
      expected: [],
    },
    {
      name: "ignores strings that do not match entity pattern",
      rows: [{ code: "Trust", color: "blue", file: "notes.md" }],
      prefixes,
      expected: [],
    },
    {
      name: "matches multiple prefix types",
      rows: [
        { a: "annotation-1abc2def", b: "callout-3xyz4ghi" },
        { a: "tag-5jkl6mno", b: "search-7pqr8stu" },
      ],
      prefixes,
      expected: ["annotation-1abc2def", "callout-3xyz4ghi", "tag-5jkl6mno", "search-7pqr8stu"],
    },
    {
      name: "returns empty for empty rows",
      rows: [],
      prefixes,
      expected: [],
    },
    {
      name: "returns empty for empty prefixes",
      rows: [{ id: "annotation-1abc2def" }],
      prefixes: [],
      expected: [],
    },
  ]

  it.each(cases)("$name", ({ rows, prefixes: pref, expected }) => {
    expect(extractEntityIdsFromRows(rows, pref).sort()).toEqual(expected.sort())
  })
})

describe("extractEntityIdsFromText", () => {
  const prefixes = ["annotation", "callout", "tag"]

  const cases: {
    name: string
    text: string
    prefixes: string[]
    expected: string[]
  }[] = [
    {
      name: "finds entity IDs in prose",
      text: "See callout-1bf2mech and annotation-1abc2def here",
      prefixes,
      expected: ["callout-1bf2mech", "annotation-1abc2def"],
    },
    {
      name: "finds entity IDs in pipe table",
      text: "| callout-1bf2mech | {count} |\n| tag-5jkl6mno | {total} |",
      prefixes,
      expected: ["callout-1bf2mech", "tag-5jkl6mno"],
    },
    {
      name: "deduplicates",
      text: "callout-1bf2mech and callout-1bf2mech again",
      prefixes,
      expected: ["callout-1bf2mech"],
    },
    {
      name: "ignores IDs preceded by word char",
      text: "xcallout-1bf2mech should not match",
      prefixes,
      expected: [],
    },
    {
      name: "ignores IDs preceded by hyphen",
      text: "foo-callout-1bf2mech should not match",
      prefixes,
      expected: [],
    },
    {
      name: "returns empty for empty prefixes",
      text: "callout-1bf2mech",
      prefixes: [],
      expected: [],
    },
    {
      name: "returns empty for no matches",
      text: "no entity IDs here",
      prefixes,
      expected: [],
    },
  ]

  it.each(cases)("$name", ({ text, prefixes: pref, expected }) => {
    expect(extractEntityIdsFromText(text, pref).sort()).toEqual(expected.sort())
  })
})
