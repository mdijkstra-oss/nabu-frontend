import { describe, it, expect } from "vitest"
import { CHUNK_CHARS } from "~/lib/embeddings/constants"
import { fnvHash } from "~/lib/utils/hash"
import { indexFileSentences } from "~/lib/text/halo"
import { accumulateScanUnits } from "./units"

const repeatSentences = (count: number, chars: number): string[] =>
  Array.from({ length: count }, (_, i) => `${String(i).padStart(3, "0")} ${"x".repeat(chars)}.`)

describe("accumulateScanUnits", () => {
  const cases: { name: string; sentences: string[] }[] = [
    { name: "a document of many short sentences", sentences: repeatSentences(200, 40) },
    { name: "a document of few long sentences", sentences: repeatSentences(20, 400) },
    { name: "a sentence longer than the budget", sentences: repeatSentences(3, CHUNK_CHARS * 2) },
    {
      name: "a mixture of lengths",
      sentences: [...repeatSentences(5, 900), ...repeatSentences(50, 10)],
    },
  ]

  it.each(cases)("keeps every unit inside the budget for $name", ({ sentences }) => {
    for (const unit of accumulateScanUnits(sentences)) {
      const joined = unit.sentences.join(" ")
      if (unit.sentences.length > 1) expect(joined.length).toBeLessThanOrEqual(CHUNK_CHARS)
    }
  })

  it.each(cases)("puts every sentence in exactly one unit for $name", ({ sentences }) => {
    const units = accumulateScanUnits(sentences)
    expect(units.flatMap((u) => u.sentences)).toEqual(sentences)
    expect(units.map((u) => u.firstSentence)).toEqual(
      units.map((_, i) => units.slice(0, i).reduce((n, u) => n + u.sentences.length, 0))
    )
    for (const unit of units) {
      expect(unit.lastSentence).toBe(unit.firstSentence + unit.sentences.length - 1)
    }
  })

  it.each(cases)("hashes each unit over its own joined texts for $name", ({ sentences }) => {
    for (const unit of accumulateScanUnits(sentences)) {
      expect(unit.hash).toBe(fnvHash(unit.sentences.join(" ")))
    }
  })

  it("produces one unit covering the whole array for a document that fits a single call", () => {
    const raw = "Rutte opened the meeting. Kaag replied at once. Rutte agreed with her."
    const sentences = indexFileSentences(raw).map((s) => s.text)
    const units = accumulateScanUnits(sentences)

    expect(units).toHaveLength(1)
    expect(units[0].firstSentence).toBe(0)
    expect(units[0].lastSentence).toBe(sentences.length - 1)
    expect(units[0].sentences).toEqual(sentences)
  })

  it("produces no unit for a document with no sentences", () => {
    expect(accumulateScanUnits([])).toEqual([])
  })
})
