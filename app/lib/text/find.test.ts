import { describe, it, expect } from "vitest"
import {
  findMatchOffset,
  findWithPartialEdges,
  expandWithContext,
  findOwningChunk,
  growToInclude,
} from "./find"

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
      name: "long needle with one replaced token below 0.9 threshold returns null",
      content: "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
      needle: "alpha bravo REPLACED delta echo foxtrot golf hotel",
      expected: null,
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

describe("findWithPartialEdges", () => {
  const cases: {
    name: string
    content: string
    needle: string
    expected: { start: number; end: number } | null
  }[] = [
    {
      name: "partial start word",
      content: "how are you doing today",
      needle: "ow are you doing",
      expected: { start: 1, end: 17 },
    },
    {
      name: "partial end word",
      content: "how are you doing today",
      needle: "how are you do",
      expected: { start: 0, end: 14 },
    },
    {
      name: "both edges partial",
      content: "how are you doing today",
      needle: "ow are you do",
      expected: { start: 1, end: 14 },
    },
    {
      name: "partial start with markdown bold",
      content: "**how** are you doing",
      needle: "ow are you doing",
      expected: { start: 3, end: 21 },
    },
    {
      name: "partial end with markdown bold",
      content: "how are you **doing**",
      needle: "how are you do",
      expected: { start: 0, end: 16 },
    },
    {
      name: "both edges partial with markdown",
      content: "**how** are you **doing**",
      needle: "ow are you do",
      expected: { start: 3, end: 20 },
    },
    {
      name: "markdown italic between words",
      content: "**how** *are* you **doing**",
      needle: "ow are you do",
      expected: { start: 3, end: 22 },
    },
    {
      name: "complete words still match",
      content: "how are you doing today",
      needle: "how are you doing",
      expected: { start: 0, end: 17 },
    },
    {
      name: "single char partial start",
      content: "how are you doing",
      needle: "w are you doing",
      expected: { start: 2, end: 17 },
    },
    {
      name: "single char partial end",
      content: "how are you doing",
      needle: "how are you d",
      expected: { start: 0, end: 13 },
    },
    {
      name: "two tokens — second complete, first partial",
      content: "how are you",
      needle: "ow are",
      expected: { start: 1, end: 7 },
    },
    {
      name: "two tokens — first complete, second partial",
      content: "how are you doing",
      needle: "you do",
      expected: { start: 8, end: 14 },
    },
    {
      name: "single token returns null",
      content: "how are you doing",
      needle: "ow",
      expected: null,
    },
    {
      name: "no match returns null",
      content: "how are you doing",
      needle: "zz are you xx",
      expected: null,
    },
    {
      name: "partial with punctuation in selection",
      content: "hello, world! how are you",
      needle: "llo, world! how are",
      expected: { start: 2, end: 21 },
    },
  ]

  it.each(cases)("$name", ({ content, needle, expected }) => {
    const result = findWithPartialEdges(content, needle)
    if (expected === null) {
      expect(result).toBeNull()
    } else {
      expect(result).toEqual(expected)
    }
  })
})

describe("expandWithContext", () => {
  const text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet"

  const cases: {
    name: string
    text: string
    start: number
    end: number
    padWords: number
    expected: string
  }[] = [
    {
      name: "pads both sides with requested words",
      text,
      start: text.indexOf("delta"),
      end: text.indexOf("delta") + "delta".length,
      padWords: 2,
      expected: "bravo charlie delta echo foxtrot",
    },
    {
      name: "clamps to start of text",
      text,
      start: text.indexOf("bravo"),
      end: text.indexOf("bravo") + "bravo".length,
      padWords: 3,
      expected: "alpha bravo charlie delta echo",
    },
    {
      name: "clamps to end of text",
      text,
      start: text.indexOf("india"),
      end: text.indexOf("india") + "india".length,
      padWords: 3,
      expected: "foxtrot golf hotel india juliet",
    },
    {
      name: "selection spanning multiple words",
      text,
      start: text.indexOf("charlie"),
      end: text.indexOf("echo") + "echo".length,
      padWords: 1,
      expected: "bravo charlie delta echo foxtrot",
    },
    {
      name: "pad larger than available words returns full text",
      text: "one two three",
      start: 4,
      end: 7,
      padWords: 10,
      expected: "one two three",
    },
  ]

  it.each(cases)("$name", ({ text, start, end, padWords, expected }) => {
    expect(expandWithContext(text, start, end, padWords)).toBe(expected)
  })
})

describe("findOwningChunk", () => {
  interface Chunk {
    id: string
    text: string
  }
  const cases: {
    name: string
    chunks: Chunk[]
    needle: string
    minWords: number
    expectedId: string | null
  }[] = [
    {
      name: "empty chunks returns null",
      chunks: [],
      needle: "anything goes here",
      minWords: 2,
      expectedId: null,
    },
    {
      name: "needle shorter than minWords returns null",
      chunks: [{ id: "a", text: "alpha beta gamma" }],
      needle: "alpha",
      minWords: 2,
      expectedId: null,
    },
    {
      name: "single chunk containing full needle",
      chunks: [{ id: "a", text: "alpha beta gamma delta epsilon" }],
      needle: "beta gamma delta",
      minWords: 2,
      expectedId: "a",
    },
    {
      name: "needle absent from all chunks returns null",
      chunks: [
        { id: "a", text: "alpha beta gamma" },
        { id: "b", text: "delta epsilon zeta" },
      ],
      needle: "nothing matches here at all",
      minWords: 2,
      expectedId: null,
    },
    {
      name: "longer run wins across chunks",
      chunks: [
        { id: "a", text: "alpha beta gamma delta epsilon zeta" },
        { id: "b", text: "epsilon zeta eta theta iota kappa" },
      ],
      needle: "delta epsilon zeta eta theta",
      minWords: 2,
      expectedId: "b",
    },
    {
      name: "needle in overlap region tiebreaks to chunk where it appears earliest",
      chunks: [
        { id: "a", text: "alpha beta gamma delta epsilon zeta" },
        { id: "b", text: "epsilon zeta eta theta iota kappa" },
      ],
      needle: "epsilon zeta",
      minWords: 2,
      expectedId: "b",
    },
    {
      name: "exact tie on length and start position falls back to first chunk index",
      chunks: [
        { id: "a", text: "epsilon zeta filler one two" },
        { id: "b", text: "epsilon zeta filler three four" },
      ],
      needle: "epsilon zeta",
      minWords: 2,
      expectedId: "a",
    },
    {
      name: "longest run below minWords returns null",
      chunks: [
        { id: "a", text: "alpha beta gamma" },
        { id: "b", text: "delta epsilon zeta" },
      ],
      needle: "beta something delta",
      minWords: 3,
      expectedId: null,
    },
    {
      name: "shared-count shortcircuit skips chunks with no shared tokens",
      chunks: [
        { id: "a", text: "completely unrelated content here" },
        { id: "b", text: "alpha beta gamma delta epsilon" },
      ],
      needle: "beta gamma delta",
      minWords: 2,
      expectedId: "b",
    },
  ]

  it.each(cases)("$name", ({ chunks, needle, minWords, expectedId }) => {
    const result = findOwningChunk(chunks, needle, { minWords })
    expect(result?.id ?? null).toBe(expectedId)
  })
})

describe("growToInclude", () => {
  const cases: {
    name: string
    text: string
    needle: string
    expected: string
  }[] = [
    {
      name: "needle fully inside text returns text unchanged",
      text: "alpha beta gamma delta epsilon zeta eta theta",
      needle: "gamma delta epsilon",
      expected: "alpha beta gamma delta epsilon zeta eta theta",
    },
    {
      name: "no overlap returns text unchanged",
      text: "alpha beta gamma",
      needle: "xxx yyy zzz",
      expected: "alpha beta gamma",
    },
    {
      name: "annotation tail extends past chunk end — tail appended",
      text: "alpha beta gamma delta epsilon",
      needle: "delta epsilon zeta eta",
      expected: "alpha beta gamma delta epsilon zeta eta",
    },
    {
      name: "annotation head extends before chunk start — head prepended",
      text: "epsilon zeta eta theta iota",
      needle: "gamma delta epsilon zeta",
      expected: "gamma delta epsilon zeta eta theta iota",
    },
    {
      name: "annotation larger than chunk — both head and tail attached",
      text: "delta epsilon zeta",
      needle: "alpha beta gamma delta epsilon zeta eta theta",
      expected: "alpha beta gamma delta epsilon zeta eta theta",
    },
    {
      name: "tail appended preserves needle punctuation",
      text: "the quick brown fox jumps",
      needle: "fox jumps over, the lazy dog.",
      expected: "the quick brown fox jumps over, the lazy dog.",
    },
    {
      name: "head prepended preserves needle punctuation",
      text: "lazy dog tomorrow",
      needle: "fox, the lazy dog",
      expected: "fox, the lazy dog tomorrow",
    },
    {
      name: "empty needle returns text unchanged",
      text: "alpha beta",
      needle: "",
      expected: "alpha beta",
    },
    {
      name: "empty text returns text unchanged",
      text: "",
      needle: "anything",
      expected: "",
    },
  ]

  it.each(cases)("$name", ({ text, needle, expected }) => {
    expect(growToInclude(text, needle)).toBe(expected)
  })
})
