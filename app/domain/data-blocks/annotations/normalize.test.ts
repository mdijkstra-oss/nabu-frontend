import { describe, it, expect } from "vitest"
import { normalizeAnnotations } from "./normalize"

const ann = (id: string, code: string | undefined, vote?: { review?: string }) => ({
  id,
  text: "some text",
  reason: "some reason",
  ...(code ? { code } : { color: "red" }),
  ...(vote !== undefined ? { vote: { find: { found: 1, missed: 0 }, ...vote } } : {}),
})

const reviewed = (review: string) => ({ review })
const voteOnly = () => ({})

describe("normalizeAnnotations", () => {
  const cases: {
    name: string
    oldDoc: unknown
    newDoc: unknown
    expected: unknown
  }[] = [
    {
      name: "clears review when code changes",
      oldDoc: { annotations: [ann("a1", "code-1", reviewed("good"))] },
      newDoc: { annotations: [ann("a1", "code-2", reviewed("good"))] },
      expected: { annotations: [ann("a1", "code-2", voteOnly())] },
    },
    {
      name: "clears review when code removed (switched to color)",
      oldDoc: { annotations: [ann("a1", "code-1", reviewed("good"))] },
      newDoc: { annotations: [ann("a1", undefined, reviewed("good"))] },
      expected: { annotations: [ann("a1", undefined, voteOnly())] },
    },
    {
      name: "preserves review when code unchanged",
      oldDoc: { annotations: [ann("a1", "code-1", reviewed("good"))] },
      newDoc: { annotations: [ann("a1", "code-1", reviewed("good"))] },
      expected: { annotations: [ann("a1", "code-1", reviewed("good"))] },
    },
    {
      name: "preserves review when no old entry (new annotation)",
      oldDoc: { annotations: [] },
      newDoc: { annotations: [ann("a1", "code-1", reviewed("good"))] },
      expected: { annotations: [ann("a1", "code-1", reviewed("good"))] },
    },
    {
      name: "no-op when annotation has no review",
      oldDoc: { annotations: [ann("a1", "code-1")] },
      newDoc: { annotations: [ann("a1", "code-2")] },
      expected: { annotations: [ann("a1", "code-2")] },
    },
    {
      name: "no-op when annotation has vote but no review",
      oldDoc: { annotations: [ann("a1", "code-1", voteOnly())] },
      newDoc: { annotations: [ann("a1", "code-2", voteOnly())] },
      expected: { annotations: [ann("a1", "code-2", voteOnly())] },
    },
    {
      name: "handles multiple annotations independently",
      oldDoc: {
        annotations: [ann("a1", "code-1", reviewed("r1")), ann("a2", "code-x", reviewed("r2"))],
      },
      newDoc: {
        annotations: [ann("a1", "code-2", reviewed("r1")), ann("a2", "code-x", reviewed("r2"))],
      },
      expected: {
        annotations: [ann("a1", "code-2", voteOnly()), ann("a2", "code-x", reviewed("r2"))],
      },
    },
    {
      name: "returns newDoc unchanged for non-annotation docs",
      oldDoc: { tags: ["a"] },
      newDoc: { tags: ["b"] },
      expected: { tags: ["b"] },
    },
    {
      name: "returns newDoc when oldDoc is not annotation doc",
      oldDoc: null,
      newDoc: { annotations: [ann("a1", "code-1", reviewed("r"))] },
      expected: { annotations: [ann("a1", "code-1", reviewed("r"))] },
    },
  ]

  it.each(cases)("$name", ({ oldDoc, newDoc, expected }) => {
    expect(normalizeAnnotations(oldDoc, newDoc)).toEqual(expected)
  })
})
