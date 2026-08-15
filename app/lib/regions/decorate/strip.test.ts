import { describe, it, expect, afterEach } from "vitest"
import { setFiles, updateFileRaw, getFileRaw, normalizeAsStored } from "~/lib/files/store"
import { INFERRED_META } from "./schema"
import { stripInferredMeta, stripInferredMetaBlocks } from "./strip"
import { annotationsBlock, document, regionsBlock, personRegion } from "./test-fixtures"

const decoratedAnnotation = {
  text: "the funding was approved",
  reason: "r",
  color: "blue",
  [INFERRED_META]: { person: ["alice"] },
}

describe("stripInferredMeta", () => {
  interface Case {
    name: string
    value: Record<string, unknown>
    rowPath?: string
    expected: Record<string, unknown> | null
  }

  const cases: Case[] = [
    {
      name: "removes the field at the root",
      value: { tags: ["a"], [INFERRED_META]: { person: ["alice"] } },
      expected: { tags: ["a"] },
    },
    {
      name: "removes the field inside every row",
      value: { annotations: [decoratedAnnotation, { text: "b", reason: "r", color: "red" }] },
      rowPath: "annotations",
      expected: {
        annotations: [
          { text: "the funding was approved", reason: "r", color: "blue" },
          { text: "b", reason: "r", color: "red" },
        ],
      },
    },
    {
      name: "removes the field at the root and inside rows together",
      value: { regions: [decoratedAnnotation], [INFERRED_META]: { person: ["alice"] } },
      rowPath: "regions",
      expected: { regions: [{ text: "the funding was approved", reason: "r", color: "blue" }] },
    },
    {
      name: "reports nothing removed as null",
      value: { annotations: [{ text: "b", reason: "r", color: "red" }] },
      rowPath: "annotations",
      expected: null,
    },
  ]

  it.each(cases)("$name", ({ value, rowPath, expected }) => {
    expect(stripInferredMeta(value, rowPath)).toEqual(expected)
  })
})

describe("stripInferredMetaBlocks", () => {
  it("removes the field from a block that carries it", () => {
    const raw = document(
      regionsBlock([personRegion("alice", 0, 4)]),
      "```json-annotations\n" + JSON.stringify({ annotations: [decoratedAnnotation] }) + "\n```"
    )

    const stripped = stripInferredMetaBlocks(raw)

    expect(stripped).not.toContain(INFERRED_META)
    expect(stripped).toContain("the funding was approved")
  })

  it("returns a document that never carried the field unchanged", () => {
    const raw = document(
      regionsBlock([personRegion("alice", 0, 4)]),
      annotationsBlock([{ text: "the funding was approved", reason: "r", color: "blue" }])
    )

    expect(stripInferredMetaBlocks(raw)).toBe(raw)
  })
})

describe("the write path", () => {
  afterEach(() => setFiles({}))

  const decorated = document(
    regionsBlock([personRegion("alice", 0, 4)]),
    "```json-annotations\n" + JSON.stringify({ annotations: [decoratedAnnotation] }) + "\n```"
  )

  const plain = document(
    regionsBlock([personRegion("alice", 0, 4)]),
    annotationsBlock([{ text: "the funding was approved", reason: "r", color: "blue" }])
  )

  it("writes no decoration to disk", () => {
    updateFileRaw("interview.md", decorated)

    expect(getFileRaw("interview.md")).not.toContain(INFERRED_META)
    expect(getFileRaw("interview.md")).toContain("the funding was approved")
  })

  it("stays byte-identical over a document that never carried one", () => {
    const once = normalizeAsStored(plain)

    expect(normalizeAsStored(once)).toBe(once)
  })

  it("settles after the strip", () => {
    const once = normalizeAsStored(decorated)

    expect(once).not.toContain(INFERRED_META)
    expect(normalizeAsStored(once)).toBe(once)
  })
})
