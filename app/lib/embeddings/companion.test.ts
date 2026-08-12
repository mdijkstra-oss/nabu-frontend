import { describe, it, expect } from "vitest"
import {
  companionFilename,
  sourceFilename,
  isCompanionFile,
  buildCompanionMarkdown,
  parseCompanionEntries,
  fastParseBlockContents,
} from "./companion"
import { diffChunks, type EmbeddingEntry } from "./diff"

describe("companionFilename", () => {
  const cases: { name: string; input: string; expected: string }[] = [
    { name: "simple doc", input: "doc.md", expected: "doc.embeddings.hidden.md" },
    { name: "nested name", input: "my_notes.md", expected: "my_notes.embeddings.hidden.md" },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(companionFilename(input)).toBe(expected)
  })
})

describe("sourceFilename", () => {
  const cases: { name: string; input: string; expected: string }[] = [
    { name: "companion to source", input: "doc.embeddings.hidden.md", expected: "doc.md" },
    { name: "nested companion", input: "my_notes.embeddings.hidden.md", expected: "my_notes.md" },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(sourceFilename(input)).toBe(expected)
  })
})

describe("isCompanionFile", () => {
  const cases: { name: string; input: string; expected: boolean }[] = [
    { name: "companion file", input: "doc.embeddings.hidden.md", expected: true },
    { name: "regular markdown", input: "doc.md", expected: false },
    { name: "other hidden file", input: "doc.hidden.md", expected: false },
    { name: "settings file", input: "settings.hidden.md", expected: false },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(isCompanionFile(input)).toBe(expected)
  })
})

describe("roundtrip", () => {
  const cases: { name: string; check: () => void }[] = [
    {
      name: "build then parse recovers entries",
      check: () => {
        const entries: EmbeddingEntry[] = [
          {
            hash: "aaa",
            text: "hello world",
            embedding: [0.1, 0.2, 0.3],
            chunkStart: 0,
            chunkEnd: 11,
          },
          {
            hash: "bbb",
            text: "goodbye",
            embedding: [0.4, 0.5, 0.6],
            chunkStart: 13,
            chunkEnd: 20,
          },
        ]
        expect(parseCompanionEntries(buildCompanionMarkdown(entries))).toEqual(entries)
      },
    },
    {
      name: "single entry roundtrip",
      check: () => {
        const entries: EmbeddingEntry[] = [
          { hash: "abc", text: "solo", embedding: [1.0], chunkStart: 0, chunkEnd: 4 },
        ]
        const markdown = buildCompanionMarkdown(entries)
        expect(markdown).toContain("```json-embeddings")
        expect(parseCompanionEntries(markdown)).toEqual(entries)
      },
    },
    {
      name: "parse returns empty for no block",
      check: () => {
        expect(parseCompanionEntries("just text")).toEqual([])
      },
    },
    {
      name: "parse returns empty for invalid json",
      check: () => {
        expect(parseCompanionEntries("```json-embeddings\nnot json\n```")).toEqual([])
      },
    },
    {
      name: "parse skips blocks with missing fields",
      check: () => {
        expect(parseCompanionEntries('```json-embeddings\n{"hash":"a"}\n```')).toEqual([])
      },
    },
    {
      name: "filename roundtrip",
      check: () => {
        const original = "my_document.md"
        expect(sourceFilename(companionFilename(original))).toBe(original)
      },
    },
  ]

  it.each(cases)("$name", ({ check }) => check())
})

describe("fastParseBlockContents", () => {
  const cases: { name: string; input: string; expected: string[] }[] = [
    {
      name: "single block",
      input:
        '```json-embeddings\n{"hash":"a","text":"hi","embedding":[0.1],"chunkStart":0,"chunkEnd":2}\n```',
      expected: ['{"hash":"a","text":"hi","embedding":[0.1],"chunkStart":0,"chunkEnd":2}'],
    },
    {
      name: "multiple blocks",
      input: '```json-embeddings\n{"hash":"a"}\n```\n\n```json-embeddings\n{"hash":"b"}\n```',
      expected: ['{"hash":"a"}', '{"hash":"b"}'],
    },
    {
      name: "no blocks",
      input: "just plain text",
      expected: [],
    },
    {
      name: "wrong language ignored",
      input: '```json-callout\n{"id":"x"}\n```',
      expected: [],
    },
    {
      name: "roundtrip with buildCompanionMarkdown",
      input: buildCompanionMarkdown([
        { hash: "aaa", text: "hello", embedding: [0.1, 0.2], chunkStart: 0, chunkEnd: 5 },
        { hash: "bbb", text: "world", embedding: [0.3, 0.4], chunkStart: 6, chunkEnd: 11 },
      ]),
      expected: [
        '{"hash":"aaa","text":"hello","embedding":[0.1,0.2],"chunkStart":0,"chunkEnd":5}',
        '{"hash":"bbb","text":"world","embedding":[0.3,0.4],"chunkStart":6,"chunkEnd":11}',
      ],
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(fastParseBlockContents(input)).toEqual(expected)
  })
})

describe("an entry the database projection would reject", () => {
  const withEntry = (entry: Record<string, unknown>): string =>
    ["```json-embeddings", JSON.stringify(entry), "```"].join("\n")

  const sound = {
    hash: "abc",
    text: "a chunk of prose",
    embedding: [0.1, 0.2, 0.3],
    chunkStart: 0,
    chunkEnd: 16,
  }

  const malformed: { name: string; entry: Record<string, unknown> }[] = [
    { name: "a vector of strings", entry: { ...sound, embedding: ["0.1", "0.2", "0.3"] } },
    { name: "a fractional offset", entry: { ...sound, chunkEnd: 16.5 } },
    { name: "a missing offset", entry: { hash: "abc", text: "x", embedding: [0.1] } },
  ]

  it.each(malformed)("is not read back: $name", ({ entry }) => {
    expect(parseCompanionEntries(withEntry(entry))).toEqual([])
  })

  it("is not rewritten into the companion by a sync that keeps it", () => {
    const stored = parseCompanionEntries(withEntry(malformed[0].entry))
    const { keep, needed } = diffChunks(
      stored,
      [{ index: 0, text: sound.text, hash: sound.hash, chunkStart: 0, chunkEnd: 16 }],
      3
    )
    expect(keep).toEqual([])
    expect(needed).toHaveLength(1)
  })

  it("reads back an entry carrying a field this version does not know", () => {
    const entry = { ...sound, futureField: "kept" }
    expect(parseCompanionEntries(withEntry(entry))).toEqual([entry])
  })
})
