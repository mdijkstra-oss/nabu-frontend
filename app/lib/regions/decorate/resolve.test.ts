import { describe, it, expect, vi, beforeEach } from "vitest"
import type { z } from "zod"
import { getBlock } from "~/lib/data-blocks/query"
import { getBlockConfig } from "~/lib/data-blocks/registry"
import type * as Halo from "~/lib/text/halo"
import { annotationsBlock, document, regionsBlock, speakerRegion } from "./test-fixtures"

const indexed = vi.hoisted(() => ({ count: 0 }))

vi.mock("~/lib/text/halo", async (importOriginal) => {
  const actual = await importOriginal<typeof Halo>()
  return {
    ...actual,
    indexFileSentences: (raw: string) => {
      indexed.count++
      return actual.indexFileSentences(raw)
    },
  }
})

const annotations = annotationsBlock([
  { text: "the funding was approved", reason: "r", color: "blue" },
])

const readAnnotations = (raw: string): void => {
  const config = getBlockConfig("json-annotations")
  if (!config) throw new Error("no annotations config")
  getBlock(raw, "json-annotations", config.schema() as z.ZodType<unknown>)
}

describe("the document memo", () => {
  beforeEach(() => {
    indexed.count = 0
  })

  it("resolves a document's regions once however often it is read", () => {
    const raw = document(regionsBlock([speakerRegion("alice", 0, 4)]), annotations)

    readAnnotations(raw)
    readAnnotations(raw)

    expect(indexed.count).toBe(1)
  })

  it("resolves again when one character of the document changed", () => {
    const raw = document(regionsBlock([speakerRegion("carol", 0, 4)]), annotations)

    readAnnotations(raw)
    readAnnotations(raw.replace("# Interview", "# Interviews"))

    expect(indexed.count).toBe(2)
  })

  it("never builds the sentence index for a document with no regions block", () => {
    readAnnotations(document(annotations))

    expect(indexed.count).toBe(0)
  })
})
