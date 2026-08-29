import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import {
  formatBlockJson,
  replaceSingletonBlock,
  stripBlocksByLanguage,
} from "~/lib/data-blocks/parse"
import { compareCodingDocuments } from "./coding-eval-comparison"

const finding = (text: string, code = "code-a"): Annotation => ({
  text,
  reason: "test",
  color: undefined,
  code,
})

const markdown = (prose: string, annotations: Annotation[]): string =>
  `${prose}\n\n\`\`\`json-annotations\n${JSON.stringify({ annotations })}\n\`\`\``

describe("coding sentence-range comparison", () => {
  it("matches exact and partial ranges while reporting exact boundaries separately", () => {
    const prose = "One. Two. Three."
    const comparison = compareCodingDocuments(
      markdown(prose, [finding("One. Two. Three.")]),
      markdown(prose, [finding("One. Two.")])
    )
    expect(comparison.relaxed).toMatchObject({ tp: 1, fp: 0, fn: 0 })
    expect(comparison.matches[0].iou).toBeCloseTo(2 / 3)
    expect(comparison.exact).toMatchObject({ tp: 0, fp: 1, fn: 1 })

    const exact = compareCodingDocuments(
      markdown(prose, [finding("One. Two.")]),
      markdown(prose, [finding("One. Two.")])
    )
    expect(exact.relaxed).toMatchObject({ tp: 1, fp: 0, fn: 0 })
    expect(exact.exact).toMatchObject({ tp: 1, fp: 0, fn: 0 })
  })

  it("pins the relaxed 0.5 boundary", () => {
    const prose = "One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten."
    const gold = markdown(prose, [finding("One. Two.")])
    expect(
      compareCodingDocuments(markdown(prose, [finding("One. Two. Three.")]), gold).relaxed
    ).toMatchObject({ tp: 1, fp: 0, fn: 0 })
    expect(
      compareCodingDocuments(markdown(prose, [finding("One. Two. Three. Four.")]), gold).relaxed
    ).toMatchObject({ tp: 1, fp: 0, fn: 0 })
    expect(compareCodingDocuments(markdown(prose, [finding(prose)]), gold).relaxed).toMatchObject({
      tp: 0,
      fp: 1,
      fn: 1,
    })
  })

  it("counts missing, spurious, and wrong-code findings", () => {
    const prose = "One. Two."
    expect(
      compareCodingDocuments(markdown(prose, []), markdown(prose, [finding("One.")])).relaxed
    ).toMatchObject({ tp: 0, fp: 0, fn: 1 })
    const spurious = compareCodingDocuments(markdown(prose, [finding("One.")]), markdown(prose, []))
    expect(spurious.relaxed).toMatchObject({ tp: 0, fp: 1, fn: 0 })
    expect(spurious.goldIsEmpty).toBe(true)
    expect(
      compareCodingDocuments(
        markdown(prose, [finding("One.", "code-b")]),
        markdown(prose, [finding("One.", "code-a")])
      ).relaxed
    ).toMatchObject({ tp: 0, fp: 1, fn: 1 })
  })

  it("collapses only same-code canonical-range duplicates", () => {
    const prose = "One. Two."
    const comparison = compareCodingDocuments(
      markdown(prose, [finding("One.")]),
      markdown(prose, [finding("One."), finding("One."), finding("One.", "code-b")])
    )
    expect(comparison.duplicateGold).toBe(1)
    expect(comparison.relaxed).toMatchObject({ tp: 1, fp: 0, fn: 1 })
  })

  it("resolves multiline anchors and reports repeated-text ambiguity", () => {
    const multiline = "Opening line\ncontinues here. Closing."
    expect(
      compareCodingDocuments(
        markdown(multiline, [finding("Opening line\ncontinues here.")]),
        markdown(multiline, [finding("Opening line\ncontinues here.")])
      ).relaxed
    ).toMatchObject({ tp: 1, fp: 0, fn: 0 })

    const repeated = "Echo. Other. Echo."
    const ambiguous = compareCodingDocuments(
      markdown(repeated, [finding("Echo.")]),
      markdown(repeated, [finding("Echo.")])
    )
    expect(ambiguous.errors.map((error) => error.type)).toEqual(["ambiguous", "ambiguous"])
    expect(ambiguous.relaxed).toMatchObject({ tp: 0, fp: 1, fn: 1 })
  })

  it("uses maximum-weight one-to-one matching", () => {
    const prose = "One. Two. Three."
    const comparison = compareCodingDocuments(
      markdown(prose, [finding("One. Two. Three."), finding("One. Two.")]),
      markdown(prose, [finding("One. Two."), finding("Two. Three.")])
    )
    expect(comparison.relaxed).toMatchObject({ tp: 2, fp: 0, fn: 0 })
    expect(comparison.matches.map((match) => match.iou).sort()).toEqual([2 / 3, 1])
  })

  it("accepts successful empty prediction and gold blocks", () => {
    const comparison = compareCodingDocuments(markdown("Quiet.", []), markdown("Quiet.", []))
    expect(comparison.relaxed).toMatchObject({ tp: 0, fp: 0, fn: 0, f1: 1 })
  })

  // The batch worker strips and trims the gold document before the pipeline sees it, and the
  // block is written back with no trailing newline. Comparing on-disk file against on-disk
  // file hides that; this walks the same path the run does.
  it("compares a document rebuilt the way the pipeline writes it", () => {
    const gold = readFileSync(
      resolve("app/lib/debug/fixtures/coding-eval/gold/corpus/a.md"),
      "utf8"
    )
    const generated = replaceSingletonBlock(
      stripBlocksByLanguage(gold, "json-annotations"),
      "json-annotations",
      formatBlockJson({ annotations: [finding("One. Two.", "fixture-code")] })
    )
    expect(compareCodingDocuments(generated, gold).relaxed).toMatchObject({ tp: 1, fp: 0, fn: 0 })
  })
})
