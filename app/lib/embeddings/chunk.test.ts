import { describe, it, expect } from "vitest"
import { chunkText, type Chunk } from "./chunk"
import {
  CHUNK_CHARS,
  CHUNK_STRIDE_CHARS,
  CHUNK_OVERLAP_RATIO,
  CHUNK_WORD_TOLERANCE,
} from "./constants"

describe("chunkText", () => {
  const cases: { name: string; input: string; check: (chunks: Chunk[]) => void }[] = [
    {
      name: "empty text returns no chunks",
      input: "",
      check: (chunks) => expect(chunks).toEqual([]),
    },
    {
      name: "whitespace only returns no chunks",
      input: "   \n\n   ",
      check: (chunks) => expect(chunks).toEqual([]),
    },
    {
      name: "text shorter than window stays as one chunk",
      input: "Hello world. This is a test.",
      check: (chunks) => {
        expect(chunks).toHaveLength(1)
        expect(chunks[0].text).toBe("Hello world. This is a test.")
        expect(chunks[0].index).toBe(0)
      },
    },
    {
      name: "text at exact window size stays as one chunk",
      input: "x".repeat(CHUNK_CHARS),
      check: (chunks) => {
        expect(chunks).toHaveLength(1)
        expect(chunks[0].text).toHaveLength(CHUNK_CHARS)
      },
    },
    {
      name: "text just above window splits into two with overlap tail",
      input: "x".repeat(CHUNK_CHARS + 100),
      check: (chunks) => {
        expect(chunks).toHaveLength(2)
        expect(chunks[0].text).toHaveLength(CHUNK_CHARS)
        expect(chunks[1].text).toHaveLength(CHUNK_CHARS + 100 - CHUNK_STRIDE_CHARS)
      },
    },
    {
      name: "chunks have sequential indices",
      input: "y".repeat(CHUNK_CHARS * 5),
      check: (chunks) => {
        chunks.forEach((chunk, i) => {
          expect(chunk.index).toBe(i)
        })
      },
    },
    {
      name: "every chunk except last is exactly window size",
      input: "z".repeat(CHUNK_CHARS * 3 + 200),
      check: (chunks) => {
        chunks.slice(0, -1).forEach((chunk) => {
          expect(chunk.text).toHaveLength(CHUNK_CHARS)
        })
      },
    },
    {
      name: "consecutive chunks overlap exactly by window minus stride",
      input: Array.from({ length: CHUNK_CHARS * 2 }, (_, i) =>
        String.fromCharCode(65 + (i % 26))
      ).join(""),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThan(1)
        const overlapLen = CHUNK_CHARS - CHUNK_STRIDE_CHARS
        const tail = chunks[0].text.slice(-overlapLen)
        const head = chunks[1].text.slice(0, overlapLen)
        expect(head).toBe(tail)
      },
    },
    {
      name: "configured overlap ratio matches stride",
      input: "a",
      check: () => {
        const actual = (CHUNK_CHARS - CHUNK_STRIDE_CHARS) / CHUNK_CHARS
        expect(actual).toBeCloseTo(CHUNK_OVERLAP_RATIO, 2)
      },
    },
    {
      name: "deterministic hashes",
      input: "Hello world.\n\nAnother paragraph.",
      check: (chunks) => {
        const second = chunkText("Hello world.\n\nAnother paragraph.")
        expect(chunks.map((c) => c.hash)).toEqual(second.map((c) => c.hash))
      },
    },
    {
      name: "trims leading and trailing whitespace",
      input: "   hello world   ",
      check: (chunks) => {
        expect(chunks).toHaveLength(1)
        expect(chunks[0].text).toBe("hello world")
      },
    },
    {
      name: "with whitespace, non-last chunks end on word boundary",
      input: "word ".repeat(800),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThan(1)
        chunks.slice(0, -1).forEach((chunk) => {
          expect(chunk.text).toMatch(/word$/)
        })
      },
    },
    {
      name: "with whitespace, non-first chunks start on word boundary",
      input: "word ".repeat(800),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThan(1)
        chunks.slice(1).forEach((chunk) => {
          expect(chunk.text).toMatch(/^word/)
        })
      },
    },
    {
      name: "word-aware chunk length stays within tolerance of window",
      input: "word ".repeat(800),
      check: (chunks) => {
        chunks.slice(0, -1).forEach((chunk) => {
          expect(chunk.text.length).toBeGreaterThanOrEqual(CHUNK_CHARS - CHUNK_WORD_TOLERANCE)
          expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_CHARS + CHUNK_WORD_TOLERANCE)
        })
      },
    },
    {
      name: "no whitespace within tolerance falls back to exact char cut",
      input: "x".repeat(CHUNK_CHARS + 100),
      check: (chunks) => {
        expect(chunks).toHaveLength(2)
        expect(chunks[0].text).toHaveLength(CHUNK_CHARS)
      },
    },
  ]

  it.each(cases)("$name", ({ input, check }) => check(chunkText(input)))
})
