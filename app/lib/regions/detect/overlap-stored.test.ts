import { describe, it, expect } from "vitest"
import { dedupeMarks } from "./overlap"
import type { Mark } from "./types"

const mark = (
  startSentence: number,
  endSentence: number,
  hitSentence: number,
  value: string
): Mark => ({
  kind: "speaker",
  quote: "q",
  hitSentence,
  value,
  startSentence,
  endSentence,
})

// region-sync.md: dedupe is handed "every mark of that kind the document currently
// has", which includes marks read back from the file store. regions-block.md
// deliberately does not enforce that hitSentence falls within the range, "because
// trailing attribution can sit outside the sentences it owns" — so a stored mark whose
// hit sits past its own range is admissible input here.
describe("dedupe over a set mixing fresh marks with marks handed in from storage", () => {
  it("keeps overlapping stored and fresh marks intact", () => {
    const deduped = dedupeMarks([mark(0, 2, 9, "a"), mark(0, 5, 9, "b")])

    expect(deduped).toHaveLength(2)
    expect(deduped.every((m) => m.endSentence >= m.startSentence)).toBe(true)
  })
})
