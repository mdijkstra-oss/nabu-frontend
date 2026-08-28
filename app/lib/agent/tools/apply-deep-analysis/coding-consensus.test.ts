import { describe, expect, it } from "vitest"
import type { CodingChunk } from "./coding-chunk"
import type { CoderSelection, CodingCandidate } from "./step-code"
import { reconcileCoderSelections } from "./consensus"

const chunk: CodingChunk = {
  id: "doc.md:0:hash",
  file: "doc.md",
  hash: "hash",
  chunkStart: 0,
  chunkEnd: 39,
  text: "One. Two. Three. Four. Five. Six.",
  sentences: Array.from({ length: 6 }, (_, index) => ({
    start: index * 10,
    end: index * 10 + 9,
    text: `Sentence ${index + 1}.`,
  })),
}

const candidate: CodingCandidate = { code: "themes", dimensionPath: "themes.md", chunk }

const selection = (
  coder: "voter-one" | "voter-two",
  start: number,
  end: number
): CoderSelection => ({ candidate, coder, start, end, reason: `${coder} reason` })

describe("reconcileCoderSelections", () => {
  it.each([
    { name: "exact", one: [2, 3], two: [2, 3], expected: [2, 3] },
    { name: "containment", one: [1, 4], two: [2, 3], expected: [2, 3] },
    { name: "partial overlap", one: [1, 3], two: [3, 5], expected: [3, 3] },
    { name: "touching inclusively", one: [1, 2], two: [2, 3], expected: [2, 2] },
  ])("returns the exact intersection for $name", ({ one, two, expected }) => {
    const result = reconcileCoderSelections(
      [selection("voter-one", one[0], one[1])],
      [selection("voter-two", two[0], two[1])]
    )
    expect(result.accepted.map(({ start, end }) => [start, end])).toEqual([expected])
    expect(result.contested).toEqual([])
  })

  it("keeps disjoint and one-sided selections contested", () => {
    const one = [selection("voter-one", 1, 1), selection("voter-one", 5, 5)]
    const two = [selection("voter-two", 3, 3)]
    const result = reconcileCoderSelections(one, two)
    expect(result.accepted).toEqual([])
    expect(result.contested).toEqual([...one, ...two])
  })

  it("does not merge adjacent accepted intersections", () => {
    const result = reconcileCoderSelections(
      [selection("voter-one", 1, 1), selection("voter-one", 2, 2)],
      [selection("voter-two", 1, 1), selection("voter-two", 2, 2)]
    )
    expect(result.accepted.map(({ start, end }) => [start, end])).toEqual([
      [1, 1],
      [2, 2],
    ])
  })
})
