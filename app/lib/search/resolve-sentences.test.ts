import { describe, it, expect } from "vitest"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { indexProseSentences } from "~/lib/text/halo"
import { resolveSentenceHits } from "./resolve-sentences"

const FILE = "doc.md"
const CONTENT = "First sentence here. Second sentence follows. Third one ends."
const files: FileStore = { [FILE]: CONTENT }
const rows = indexProseSentences(CONTENT)

const spanOf = (start: number, end: number) => ({
  chunkStart: rows[start].start,
  chunkEnd: rows[end].end,
  text: CONTENT.slice(rows[start].start, rows[end].end),
})

interface Case {
  name: string
  hit: SearchHit
  expected: SearchHit
}

const cases: Case[] = [
  {
    name: "sentence range becomes byte offsets and sliced text",
    hit: { file: FILE, text: "quote", startSentence: 0, endSentence: 1 },
    expected: { file: FILE, startSentence: 0, endSentence: 1, ...spanOf(0, 1) },
  },
  {
    name: "single-sentence range",
    hit: { file: FILE, startSentence: 2, endSentence: 2 },
    expected: { file: FILE, startSentence: 2, endSentence: 2, ...spanOf(2, 2) },
  },
  {
    name: "chunk hit stays untouched",
    hit: { file: FILE, chunkStart: 0, chunkEnd: 10, text: "First sent" },
    expected: { file: FILE, chunkStart: 0, chunkEnd: 10, text: "First sent" },
  },
  {
    name: "hit without a sentence range stays untouched",
    hit: { file: FILE, text: "quote" },
    expected: { file: FILE, text: "quote" },
  },
  {
    name: "out-of-range sentence index stays untouched",
    hit: { file: FILE, text: "quote", startSentence: 0, endSentence: 99 },
    expected: { file: FILE, text: "quote", startSentence: 0, endSentence: 99 },
  },
  {
    name: "unknown file stays untouched",
    hit: { file: "missing.md", text: "quote", startSentence: 0, endSentence: 1 },
    expected: { file: "missing.md", text: "quote", startSentence: 0, endSentence: 1 },
  },
]

describe("resolveSentenceHits", () => {
  it.each(cases)("$name", ({ hit, expected }) => {
    expect(resolveSentenceHits([hit], files)).toEqual([expected])
  })
})
