import { describe, it, expect } from "vitest"
import { findMatchOffset } from "./find"

describe("findMatchOffset", () => {
  const cases: {
    name: string
    content: string
    needle: string
    expected: { start: number; end: number } | null
  }[] = [
    {
      name: "exact token match",
      content: "the quick brown fox jumps over the lazy dog",
      needle: "brown fox jumps",
      expected: { start: 10, end: 25 },
    },
    {
      name: "case-insensitive token match",
      content: "The Quick Brown Fox",
      needle: "quick brown",
      expected: { start: 4, end: 15 },
    },
    {
      name: "no match returns null",
      content: "hello world",
      needle: "something completely different and long enough",
      expected: null,
    },
    {
      name: "token match ignores punctuation",
      content: "Hello, world! How are you?",
      needle: "hello world",
      expected: { start: 0, end: 13 },
    },
    {
      name: "long needle with all tokens present matches at threshold 1",
      content: "alpha bravo charlie delta echo foxtrot golf hotel india",
      needle: "bravo charlie delta echo foxtrot golf",
      expected: { start: 6, end: 43 },
    },
    {
      name: "short needle requires all tokens",
      content: "the quick brown fox jumps over",
      needle: "quick brown",
      expected: { start: 4, end: 15 },
    },
    {
      name: "short needle with missing token returns null",
      content: "the quick brown fox jumps over",
      needle: "quick zebra",
      expected: null,
    },
    {
      name: "single token match",
      content: "the quick brown fox",
      needle: "brown",
      expected: { start: 10, end: 15 },
    },
    {
      name: "empty needle returns null",
      content: "hello world",
      needle: "",
      expected: null,
    },
    {
      name: "long needle degrades to 0.8 threshold",
      content: "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
      needle: "alpha bravo REPLACED delta echo foxtrot golf hotel",
      expected: { start: 0, end: 49 },
    },
    {
      name: "long needle below 0.8 threshold returns null",
      content: "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
      needle: "xxx yyy zzz aaa bbb ccc ddd hotel",
      expected: null,
    },
  ]

  it.each(cases)("$name", ({ content, needle, expected }) => {
    const result = findMatchOffset(content, needle)
    if (expected === null) {
      expect(result).toBeNull()
    } else {
      expect(result).toEqual(expected)
    }
  })
})
