import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "fs"
import { join } from "path"
import { findMatches, getMatchedText, type Match } from "./search"
import { normalizeContent } from "./normalize"

type ExpectedMatch = Match & { content?: string }

interface Scenario {
  name: string
  needle: string
  expected: { matches: ExpectedMatch[] }
}

const scenariosDir = join(__dirname, "scenarios")
const content = readFileSync(join(scenariosDir, "content.md"), "utf-8")

const loadScenarios = (): Scenario[] =>
  readdirSync(scenariosDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(scenariosDir, f), "utf-8")))

describe("findMatches", () => {
  const scenarios = loadScenarios()

  it.each(scenarios)("$name", ({ needle, expected }) => {
    const matches = findMatches(content, needle)

    expect(matches.length).toBe(expected.matches.length)

    matches.forEach((match, i) => {
      const exp = expected.matches[i]
      expect(match).toEqual({ start: exp.start, end: exp.end, fuzzy: exp.fuzzy })

      if (exp.content) {
        expect(getMatchedText(content, match)).toBe(exp.content)
      }
    })
  })

  const normalizedCases = [
    {
      name: "needle with trailing newline matches content without one",
      content: "# Notes",
      needle: "# Notes\n",
      expected: { start: 0, end: 0, fuzzy: false },
    },
    {
      name: "whitespace-only blank line matches empty blank line",
      content: "heading\n   \ntext after gap",
      needle: "heading\n\ntext after gap",
      expected: { start: 0, end: 2, fuzzy: false },
    },
    {
      name: "tabs-only blank line matches empty blank line",
      content: "heading\n\t\t\ntext after gap",
      needle: "heading\n\ntext after gap",
      expected: { start: 0, end: 2, fuzzy: false },
    },
    {
      name: "multi-line block with blank mismatch",
      content: "Sarah is a senior nurse\n   \nin the emergency department",
      needle: "Sarah is a senior nurse\n\nin the emergency department",
      expected: { start: 0, end: 2, fuzzy: false },
    },
  ]

  it.each(normalizedCases)("$name", ({ content: c, needle, expected }) => {
    const matches = findMatches(normalizeContent(c), normalizeContent(needle))
    expect(matches.length).toBe(1)
    expect(matches[0]).toEqual(expected)
  })

  const tokenCases = [
    {
      name: "token fallback: multi-line with unicode quote mismatch",
      content: [
        "The segment links outcomes directly to what people do.",
        "",
        "The segment uses explicit causal links: \u2018als we ons aan de regels houden\u2026\u2019, \u2018het is aan ons\u2019.",
      ].join("\n"),
      needle: [
        "The segment links outcomes directly to what people do.",
        "",
        "The segment uses explicit causal links: 'als we ons aan de regels houden...', 'het is aan ons'.",
      ].join("\n"),
      expected: { start: 0, end: 2, fuzzy: true },
    },
    {
      name: "token fallback: single line with stripped punctuation matches",
      content:
        "She said \u2018we moeten volhouden\u2019 and \u2018het is aan ons\u2019 during the press conference about the pandemic response.",
      needle:
        "She said 'we moeten volhouden' and 'het is aan ons' during the press conference about the pandemic response.",
      expected: { start: 0, end: 0, fuzzy: true },
    },
    {
      name: "token fallback: not enough words returns no match",
      content: "aaa bbb ccc",
      needle: "xxx yyy zzz",
      expected: null,
    },
  ]

  it.each(tokenCases)("$name", ({ content: c, needle, expected }) => {
    const matches = findMatches(c, needle)
    if (expected === null) {
      expect(matches.length).toBe(0)
    } else {
      expect(matches.length).toBe(1)
      expect(matches[0]).toEqual(expected)
    }
  })

  const longLine = (base: string, length: number): string => {
    const padding = "x".repeat(Math.max(0, length - base.length))
    return base + padding
  }

  const prefixCases = [
    {
      name: "explicit ... prefix in multi-line block (via token)",
      content: [
        longLine("This is a very long paragraph about something important in the research", 210),
        "second line here",
        "third line here",
      ].join("\n"),
      needle: [
        "This is a very long paragraph about something important in the research...",
        "second line here",
        "third line here",
      ].join("\n"),
      expected: { start: 0, end: 2, fuzzy: true },
    },
    {
      name: "implicit long prefix in multi-line block (via token)",
      content: [
        "first line",
        longLine(
          "This is a very long content line that the model tried to reproduce but got the ending wrong because",
          260
        ),
        "third line",
      ].join("\n"),
      needle: [
        "first line",
        longLine(
          "This is a very long content line that the model tried to reproduce but got the ending wrong because",
          170
        ) + " different ending here",
        "third line",
      ].join("\n"),
      expected: { start: 0, end: 2, fuzzy: true },
    },
    {
      name: "consecutive disambiguation: duplicate first line resolved by second",
      content: "alpha\nbeta\nalpha\ngamma",
      needle: "alpha\nbeta",
      expected: { start: 0, end: 1, fuzzy: false },
    },
    {
      name: "progressive trim in multi-line block (via token)",
      content: [
        longLine(
          "A unique prefix that identifies this particular line in the document and has enough",
          210
        ) + " correct trailing words",
        "short second line",
      ].join("\n"),
      needle: [
        longLine(
          "A unique prefix that identifies this particular line in the document and has enough",
          210
        ) + " wrong trailing words",
        "short second line",
      ].join("\n"),
      expected: { start: 0, end: 1, fuzzy: true },
    },
    {
      name: "prefix: matches when needle is above min length threshold",
      content:
        "the researcher investigated the underlying mechanisms of cellular regeneration in various tissue samples collected from multiple donors over time\nother stuff",
      needle:
        "the researcher investigated the underlying mechanisms of cellular regeneration in various tissue samples...",
      expected: { start: 0, end: 0, fuzzy: true },
    },
    {
      name: "explicit prefix: case and punctuation mismatch with growing narrows to one",
      content: [
        "oh boy this llm is incredibly dumb and wrong about everything in the whole entire world and universe and beyond the galaxy forever",
        "next line",
        "oh boy this llm is incredibly smart and right about everything in the whole entire world and universe and beyond the galaxy forever",
        "other line",
      ].join("\n"),
      needle: [
        "Oh BOY, THIS llm is incredibly dumb and completely mistaken regarding all things...",
        "next line",
      ].join("\n"),
      expected: { start: 0, end: 1, fuzzy: true },
    },
    {
      name: "explicit prefix: many wrong tail words where token fails",
      content: [
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu",
        "following line",
      ].join("\n"),
      needle: [
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike wrong1 wrong2 wrong3 wrong4 wrong5 wrong6...",
        "following line",
      ].join("\n"),
      expected: { start: 0, end: 1, fuzzy: true },
    },
    {
      name: "implicit prefix: long line with wrong tail where token fails",
      content: [
        "the quick brown fox jumped over the lazy dog and then ran through the forest until reaching the river where it stopped to drink some water and rest for a while before continuing on its long journey home across the mountains and valleys and plains stretching endlessly",
        "anchor line",
      ].join("\n"),
      needle: [
        "the quick brown fox jumped over the lazy dog and then ran through the forest until reaching the river where it stopped to drink some water and rest for a while COMPLETELY DIFFERENT WRONG ENDING that does not match",
        "anchor line",
      ].join("\n"),
      expected: { start: 0, end: 1, fuzzy: true },
    },
  ]

  it.each(prefixCases)("$name", ({ content: c, needle, expected }) => {
    const matches = findMatches(c, needle)
    expect(matches.length).toBe(1)
    expect(matches[0]).toEqual(expected)
  })
})
