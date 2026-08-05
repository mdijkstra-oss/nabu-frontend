import { describe, it, expect } from "vitest"
import { diffChunks, type EmbeddingEntry } from "./diff"
import type { Chunk } from "./chunk"

describe("diffChunks", () => {
  const DIMENSIONS = 2

  const entry = (
    hash: string,
    text: string,
    chunkStart = 0,
    chunkEnd: number = text.length
  ): EmbeddingEntry => ({
    hash,
    text,
    embedding: [0.1, 0.2],
    chunkStart,
    chunkEnd,
  })

  const entryAtWidth = (hash: string, text: string, width: number): EmbeddingEntry => ({
    hash,
    text,
    embedding: Array.from({ length: width }, (_, i) => i / 10),
    chunkStart: 0,
    chunkEnd: text.length,
  })

  const chunk = (
    hash: string,
    text: string,
    index: number,
    chunkStart = 0,
    chunkEnd: number = text.length
  ): Chunk => ({
    hash,
    text,
    index,
    chunkStart,
    chunkEnd,
  })

  const cases: {
    name: string
    existing: EmbeddingEntry[]
    current: Chunk[]
    expectedKeep: EmbeddingEntry[]
    expectedNeeded: Chunk[]
  }[] = [
    {
      name: "all new chunks when no existing",
      existing: [],
      current: [chunk("aaa", "hello", 0), chunk("bbb", "world", 1)],
      expectedKeep: [],
      expectedNeeded: [chunk("aaa", "hello", 0), chunk("bbb", "world", 1)],
    },
    {
      name: "all kept when hashes match",
      existing: [entry("aaa", "hello"), entry("bbb", "world")],
      current: [chunk("aaa", "hello", 0), chunk("bbb", "world", 1)],
      expectedKeep: [entry("aaa", "hello"), entry("bbb", "world")],
      expectedNeeded: [],
    },
    {
      name: "mixed keep and needed",
      existing: [entry("aaa", "hello"), entry("bbb", "world")],
      current: [chunk("aaa", "hello", 0), chunk("ccc", "new text", 1)],
      expectedKeep: [entry("aaa", "hello")],
      expectedNeeded: [chunk("ccc", "new text", 1)],
    },
    {
      name: "removed chunks are not kept",
      existing: [entry("aaa", "hello"), entry("bbb", "world")],
      current: [chunk("aaa", "hello", 0)],
      expectedKeep: [entry("aaa", "hello")],
      expectedNeeded: [],
    },
    {
      name: "empty current means nothing to keep",
      existing: [entry("aaa", "hello")],
      current: [],
      expectedKeep: [],
      expectedNeeded: [],
    },
    {
      name: "kept entries are re-stamped with current chunk offsets",
      existing: [entry("aaa", "hello", 100, 105)],
      current: [chunk("aaa", "hello", 0, 200, 205)],
      expectedKeep: [entry("aaa", "hello", 200, 205)],
      expectedNeeded: [],
    },
    {
      name: "a hash hit at the wrong width is needed, not kept",
      existing: [entryAtWidth("aaa", "hello", 3)],
      current: [chunk("aaa", "hello", 0)],
      expectedKeep: [],
      expectedNeeded: [chunk("aaa", "hello", 0)],
    },
    {
      name: "widths are judged one entry at a time",
      existing: [entryAtWidth("aaa", "hello", 3), entry("bbb", "world")],
      current: [chunk("aaa", "hello", 0), chunk("bbb", "world", 1)],
      expectedKeep: [entry("bbb", "world")],
      expectedNeeded: [chunk("aaa", "hello", 0)],
    },
  ]

  it.each(cases)("$name", ({ existing, current, expectedKeep, expectedNeeded }) => {
    const result = diffChunks(existing, current, DIMENSIONS)
    expect(result.keep).toEqual(expectedKeep)
    expect(result.needed).toEqual(expectedNeeded)
  })
})
