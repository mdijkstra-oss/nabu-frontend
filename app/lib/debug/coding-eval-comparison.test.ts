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

  it("retains same-code canonical-range duplicates as multiset instances", () => {
    const prose = "One. Two."
    const comparison = compareCodingDocuments(
      markdown(prose, [finding("One.")]),
      markdown(prose, [finding("One."), finding("One."), finding("One.", "code-b")])
    )
    expect(comparison.duplicateGold).toBe(1)
    expect(comparison.soft).toMatchObject({ tp: 1, fp: 0, fn: 2 })
    expect(comparison.relaxed).toMatchObject({ tp: 1, fp: 0, fn: 2 })
  })

  it("resolves multiline and repeated anchors by monotone occurrence", () => {
    const multiline = "Opening line\ncontinues here. Closing."
    expect(
      compareCodingDocuments(
        markdown(multiline, [finding("Opening line\ncontinues here.")]),
        markdown(multiline, [finding("Opening line\ncontinues here.")])
      ).relaxed
    ).toMatchObject({ tp: 1, fp: 0, fn: 0 })

    const repeated = "Echo. Other. Echo."
    const repeatedComparison = compareCodingDocuments(
      markdown(repeated, [finding("Echo.")]),
      markdown(repeated, [finding("Echo.")])
    )
    expect(repeatedComparison.errors).toEqual([])
    expect(repeatedComparison.relaxed).toMatchObject({ tp: 1, fp: 0, fn: 0 })

    const separateCodes = compareCodingDocuments(
      markdown(repeated, [finding("Echo.", "code-a"), finding("Echo.", "code-b")]),
      markdown(repeated, [finding("Echo.", "code-a"), finding("Echo.", "code-b")])
    )
    expect(separateCodes.matches.map((match) => match.prediction.range.start)).toEqual([0, 0])
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

  it("gives partial soft credit below the relaxed threshold and penalizes wide spans", () => {
    const prose = "One. Two. Three. Four. Five."
    const comparison = compareCodingDocuments(
      markdown(prose, [finding(prose)]),
      markdown(prose, [finding("One. Two.")])
    )
    expect(comparison.soft).toMatchObject({ tp: 0.4, fp: 0.6, fn: 0.6 })
    expect(comparison.soft.f1).toBeCloseTo(0.4)
    expect(comparison.relaxed).toMatchObject({ tp: 0, fp: 1, fn: 1 })
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
