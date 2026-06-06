import { describe, it, expect } from "vitest"
import { chunkText, MAX_SNAP_EXTENSION, type Chunk } from "./chunk"
import {
  CHUNK_CHARS,
  CHUNK_STRIDE_CHARS,
  CHUNK_OVERLAP_RATIO,
  CHUNK_WORD_TOLERANCE,
} from "./constants"

const sentence = (i: number): string =>
  `This is sentence number ${i} and it carries a few words of payload.`

const sentencesText = (n: number): string =>
  Array.from({ length: n }, (_, i) => sentence(i)).join(" ")

const endsAtSentence = (text: string): boolean => /[.!?]\s*$/.test(text)
const startsAtSentence = (text: string): boolean => /^[A-Z]/.test(text)

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
      name: "text just above window splits into multiple sentence-aligned chunks",
      input: sentencesText(40),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThan(1)
      },
    },
    {
      name: "chunks have sequential indices",
      input: sentencesText(100),
      check: (chunks) => {
        chunks.forEach((chunk, i) => {
          expect(chunk.index).toBe(i)
        })
      },
    },
    {
      name: "non-first chunks start at sentence (capital letter)",
      input: sentencesText(100),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThan(1)
        chunks.slice(1).forEach((chunk) => {
          expect(startsAtSentence(chunk.text)).toBe(true)
        })
      },
    },
    {
      name: "non-last chunks end at sentence boundary (terminator)",
      input: sentencesText(100),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThan(1)
        chunks.slice(0, -1).forEach((chunk) => {
          expect(endsAtSentence(chunk.text)).toBe(true)
        })
      },
    },
    {
      name: "chunk lengths stay within CHUNK_CHARS ± MAX_SNAP_EXTENSION",
      input: sentencesText(100),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThan(1)
        chunks.slice(0, -1).forEach((chunk) => {
          expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_CHARS + MAX_SNAP_EXTENSION)
        })
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
      name: "single chunk records start=0 and end=text.length",
      input: "Hello world. This is a test.",
      check: (chunks) => {
        expect(chunks).toHaveLength(1)
        expect(chunks[0].chunkStart).toBe(0)
        expect(chunks[0].chunkEnd).toBe("Hello world. This is a test.".length)
      },
    },
    {
      name: "leading whitespace shifts offsets",
      input: "   hello world   ",
      check: (chunks) => {
        expect(chunks).toHaveLength(1)
        expect(chunks[0].chunkStart).toBe(3)
        expect(chunks[0].chunkEnd).toBe(3 + "hello world".length)
      },
    },
    {
      name: "multi-chunk offsets satisfy text === source.slice(chunkStart, chunkEnd)",
      input: sentencesText(100),
      check: (chunks) => {
        const source = sentencesText(100)
        expect(chunks.length).toBeGreaterThan(1)
        for (const chunk of chunks) {
          expect(source.slice(chunk.chunkStart, chunk.chunkEnd)).toBe(chunk.text)
        }
      },
    },
    {
      name: "multi-chunk offsets monotonic and last reaches end",
      input: sentencesText(100),
      check: (chunks) => {
        const source = sentencesText(100)
        for (let i = 1; i < chunks.length; i++) {
          expect(chunks[i].chunkStart).toBeGreaterThan(chunks[i - 1].chunkStart)
        }
        expect(chunks[chunks.length - 1].chunkEnd).toBe(source.length)
      },
    },
    {
      name: "consecutive chunks overlap (stride < window)",
      input: sentencesText(100),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThan(1)
        for (let i = 1; i < chunks.length; i++) {
          expect(chunks[i].chunkStart).toBeLessThan(chunks[i - 1].chunkEnd)
        }
      },
    },
    {
      name: "text without sentence boundaries falls back to original window edges (cap kicks in)",
      input: "x".repeat(CHUNK_CHARS + 100),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThanOrEqual(2)
        chunks.forEach((chunk) => {
          expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_CHARS + CHUNK_WORD_TOLERANCE)
        })
      },
    },
  ]

  it.each(cases)("$name", ({ input, check }) => check(chunkText(input)))
})
