import { describe, it, expect } from "vitest"
import { buildAnnotationPatchOps } from "./merge"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"

const makeAnnotation = (overrides: Partial<Annotation> & { text: string }): Annotation => ({
  text: overrides.text,
  reason: overrides.reason ?? "",
  code: overrides.code,
  color: overrides.color,
  id: overrides.id,
  actor: overrides.actor,
  vote: overrides.vote,
})

describe("buildAnnotationPatchOps", () => {
  const docText = "The cat sat on the mat and the dog lay on the rug"
  const codeId = "theme-comfort"
  const newId = "annotation-test123"

  describe("no overlap — creates new annotation", () => {
    const cases = [
      {
        name: "no existing annotations",
        annotations: [] as Annotation[],
        selection: { start: 0, end: 7 },
        expectedText: "The cat",
      },
      {
        name: "existing annotation at different location",
        annotations: [makeAnnotation({ id: "ann-1", text: "the dog lay", code: codeId })],
        selection: { start: 0, end: 7 },
        expectedText: "The cat",
      },
      {
        name: "adjacent but not overlapping",
        annotations: [makeAnnotation({ id: "ann-1", text: "sat on", code: codeId })],
        selection: { start: 0, end: 8 },
        expectedText: "The cat ",
      },
    ]

    it.each(cases)("$name", ({ annotations, selection, expectedText }) => {
      const result = buildAnnotationPatchOps(selection, docText, annotations, codeId, newId)
      expect(result.ops).toHaveLength(1)
      expect(result.ops[0]).toEqual({
        op: "add",
        path: "/annotations/-",
        value: { id: newId, text: expectedText, reason: "", code: codeId, actor: "user" },
      })
    })
  })

  describe("overlap — merges annotations", () => {
    const cases = [
      {
        name: "selection extends existing to the right",
        annotations: [
          makeAnnotation({ id: "ann-1", text: "The cat sat", reason: "cozy", code: codeId }),
        ],
        selection: { start: 8, end: 22 },
        expectedText: "The cat sat on the mat",
        expectedReason: "cozy",
      },
      {
        name: "selection extends existing to the left",
        annotations: [
          makeAnnotation({ id: "ann-1", text: "sat on the mat", reason: "warmth", code: codeId }),
        ],
        selection: { start: 0, end: 11 },
        expectedText: "The cat sat on the mat",
        expectedReason: "warmth",
      },
      {
        name: "selection fully contained within existing",
        annotations: [
          makeAnnotation({
            id: "ann-1",
            text: "The cat sat on the mat",
            reason: "comfort",
            code: codeId,
          }),
        ],
        selection: { start: 4, end: 11 },
        expectedText: "The cat sat on the mat",
        expectedReason: "comfort",
      },
      {
        name: "selection fully contains existing",
        annotations: [
          makeAnnotation({ id: "ann-1", text: "cat sat", reason: "motion", code: codeId }),
        ],
        selection: { start: 0, end: 22 },
        expectedText: "The cat sat on the mat",
        expectedReason: "motion",
      },
    ]

    it.each(cases)("$name", ({ annotations, selection, expectedText, expectedReason }) => {
      const result = buildAnnotationPatchOps(selection, docText, annotations, codeId, newId)
      expect(result.ops).toHaveLength(2)
      expect(result.ops[0]).toEqual({ op: "remove", path: "/annotations[id=ann-1]" })
      expect(result.ops[1]).toEqual({
        op: "add",
        path: "/annotations/-",
        value: {
          id: newId,
          text: expectedText,
          reason: expectedReason,
          code: codeId,
          actor: "user",
        },
      })
    })
  })

  describe("carries vote.review on merge", () => {
    const cases = [
      {
        name: "preserves vote with review",
        annotations: [
          makeAnnotation({
            id: "ann-1",
            text: "The cat sat",
            reason: "important",
            code: codeId,
            vote: { find: { found: 2, missed: 1 }, review: "check this" },
          }),
        ],
        selection: { start: 8, end: 22 },
        expectedVote: { find: { found: 2, missed: 1 }, review: "check this" },
      },
      {
        name: "no vote field when review absent",
        annotations: [
          makeAnnotation({
            id: "ann-1",
            text: "The cat sat",
            reason: "fine",
            code: codeId,
            vote: { find: { found: 3, missed: 0 } },
          }),
        ],
        selection: { start: 8, end: 22 },
        expectedVote: undefined,
      },
      {
        name: "no vote field when vote undefined",
        annotations: [
          makeAnnotation({ id: "ann-1", text: "The cat sat", reason: "fine", code: codeId }),
        ],
        selection: { start: 8, end: 22 },
        expectedVote: undefined,
      },
    ]

    it.each(cases)("$name", ({ annotations, selection, expectedVote }) => {
      const result = buildAnnotationPatchOps(selection, docText, annotations, codeId, newId)
      const addOp = result.ops.find((op) => op.op === "add")
      const value = (addOp as { value: Record<string, unknown> }).value
      expect(value.vote).toEqual(expectedVote)
    })
  })

  describe("annotation without id", () => {
    it("skips remove op when existing has no id", () => {
      const annotations = [makeAnnotation({ text: "The cat sat", reason: "old", code: codeId })]
      const result = buildAnnotationPatchOps(
        { start: 8, end: 22 },
        docText,
        annotations,
        codeId,
        newId
      )
      expect(result.ops).toHaveLength(1)
      expect(result.ops[0].op).toBe("add")
    })
  })
})
