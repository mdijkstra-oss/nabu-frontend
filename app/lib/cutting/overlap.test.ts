import { describe, it, expect } from "vitest"
import { fnvHash } from "~/lib/utils/hash"
import {
  documentOfSentences,
  fixtureDocument,
  ruleWith,
  sentenceOfLength,
  type Document,
} from "./test-documents"
import { OVERLAP_CHARS } from "./constants"
import { cutUnits, type BoundaryTest } from "./units"
import { applyOverlap, type ChunkSpan } from "./overlap"

const chunksOf = (document: Document, isBoundary?: BoundaryTest): ChunkSpan[] =>
  applyOverlap(
    document.rows,
    cutUnits(document.prose, document.rows, isBoundary && ruleWith(isBoundary))
  )

const chunkHash = (prose: string, span: ChunkSpan): string =>
  fnvHash(prose.slice(span.chunkStart, span.chunkEnd))

describe("applyOverlap", () => {
  // A body sentence outruns the overlap and a head sentence fits inside it, so an extension
  // reaches exactly one sentence past its unit and stops.
  const BODY_CHARS = OVERLAP_CHARS + 60
  const HEAD_CHARS = Math.floor(OVERLAP_CHARS / 2)

  const documents: { name: string; document: Document; test?: BoundaryTest }[] = [
    { name: "links-and-code.md", document: fixtureDocument("links-and-code.md") },
    { name: "long-sentence-prose.md", document: fixtureDocument("long-sentence-prose.md") },
    { name: "tables-and-lists.md", document: fixtureDocument("tables-and-lists.md") },
    { name: "transcript-short-turns.md", document: fixtureDocument("transcript-short-turns.md") },
    { name: "mostly-code.md", document: fixtureDocument("mostly-code.md") },
    {
      name: "sentences wider than the overlap",
      document: documentOfSentences(
        Array.from({ length: 12 }, (_, index) => sentenceOfLength(index, OVERLAP_CHARS * 2))
      ),
      test: () => true,
    },
  ]

  it.each(documents)("starts every chunk where its unit starts: $name", ({ document, test }) => {
    for (const span of chunksOf(document, test)) expect(span.chunkStart).toBe(span.unit.charStart)
  })

  it.each(documents)("ends every chunk at a sentence end: $name", ({ document, test }) => {
    const sentenceEnds = new Set(document.rows.map((row) => row.end))
    for (const span of chunksOf(document, test)) {
      expect(sentenceEnds.has(span.chunkEnd)).toBe(true)
      expect(span.chunkEnd).toBeGreaterThanOrEqual(span.unit.charEnd)
      expect(span.chunkEnd).toBeLessThanOrEqual(span.unit.charEnd + OVERLAP_CHARS)
    }
  })

  it.each(documents)("leaves the last chunk unextended: $name", ({ document, test }) => {
    const spans = chunksOf(document, test)
    const last = spans.at(-1)
    expect(last?.chunkEnd).toBe(last?.unit.charEnd)
  })

  it("keeps a chunk at its unit when no sentence ends inside the extension", () => {
    const document = documentOfSentences(
      Array.from({ length: 6 }, (_, index) => sentenceOfLength(index, OVERLAP_CHARS * 2))
    )
    for (const span of chunksOf(document, () => true)) expect(span.chunkEnd).toBe(span.unit.charEnd)
  })

  it("takes a sentence ending exactly at the reach of the extension", () => {
    const document = documentOfSentences([
      sentenceOfLength(0, BODY_CHARS),
      sentenceOfLength(1, BODY_CHARS),
      sentenceOfLength(2, OVERLAP_CHARS - 1),
      sentenceOfLength(3, BODY_CHARS),
      sentenceOfLength(4, BODY_CHARS),
    ])
    const spans = chunksOf(document, (_prose, gap) => gap === document.rows[1].end)

    expect(spans[0].chunkEnd).toBe(spans[0].unit.charEnd + OVERLAP_CHARS)
    expect(spans[0].chunkEnd).toBe(document.rows[2].end)
  })

  it("does not extend the last chunk even when sentences follow it", () => {
    const document = documentOfSentences(
      Array.from({ length: 40 }, (_, index) => sentenceOfLength(index, HEAD_CHARS))
    )
    const units = cutUnits(
      document.prose,
      document.rows,
      ruleWith(() => true)
    ).slice(0, 2)
    const spans = applyOverlap(document.rows, units)

    expect(spans.at(-1)?.chunkEnd).toBe(units.at(-1)?.charEnd)
  })

  it("re-hashes the first chunk, but not the first unit, when the second unit's head is edited", () => {
    const texts = [
      sentenceOfLength(0, BODY_CHARS),
      sentenceOfLength(1, BODY_CHARS),
      sentenceOfLength(2, HEAD_CHARS),
      sentenceOfLength(3, BODY_CHARS),
      sentenceOfLength(4, BODY_CHARS),
    ]
    const original = documentOfSentences(texts)
    const edited = documentOfSentences(
      texts.map((text, index) => (index === 2 ? text.toUpperCase() : text))
    )
    const cutAfterSecondSentence: BoundaryTest = (_prose, gap) => gap === original.rows[1].end

    const before = chunksOf(original, cutAfterSecondSentence)
    const after = chunksOf(edited, cutAfterSecondSentence)

    expect(before.length).toBe(2)
    expect(before[0].chunkEnd).toBe(original.rows[2].end)
    expect(after[0].unit.hash).toBe(before[0].unit.hash)
    expect(chunkHash(edited.prose, after[0])).not.toBe(chunkHash(original.prose, before[0]))
  })

  it("produces no chunks without units", () => {
    expect(applyOverlap([], [])).toEqual([])
  })
})
