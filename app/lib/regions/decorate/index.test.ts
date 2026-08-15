import { describe, it, expect } from "vitest"
import type { z } from "zod"
import { getBlock, getBlocks } from "~/lib/data-blocks/query"
import { getBlockConfig } from "~/lib/data-blocks/registry"
import type { InferredMeta } from "./schema"
import {
  TRANSCRIPT_PROSE,
  annotationsBlock,
  attributesBlock,
  calloutBlock,
  chartBlock,
  dateRegion,
  document,
  regionsBlock,
  personRegion,
} from "./test-fixtures"

type Decorated = Record<string, unknown> & { inferred_meta?: InferredMeta }

const schemaOf = (language: string): z.ZodType<Decorated> => {
  const config = getBlockConfig(language)
  if (!config) throw new Error(`no block config for ${language}`)
  return config.schema() as z.ZodType<Decorated>
}

const readSingleton = (raw: string, language: string): Decorated => {
  const parsed = getBlock(raw, language, schemaOf(language))
  if (!parsed) throw new Error(`no ${language} block parsed`)
  return parsed
}

const readRows = (raw: string, language: string, rowPath: string): Decorated[] =>
  readSingleton(raw, language)[rowPath] as Decorated[]

const annotation = (text: string, id: string) => ({ text, reason: "r", color: "blue", id })

const ALICE_SPOKE = "the funding was approved"
const BOB_SPOKE = "He asked for another month"
const ACROSS_SPEAKERS = "She thanked the committee. Bob objected to the timeline."
const ABSENT = "Carol proposed a vote on the merger"

describe("decorated read path", () => {
  it("gives each document its own regions behind the shared parse cache", () => {
    const annotations = annotationsBlock([annotation(ALICE_SPOKE, "a1")])
    const spokenByAlice = document(regionsBlock([personRegion("alice", 0, 4)]), annotations)
    const spokenByBob = document(regionsBlock([personRegion("bob", 0, 4)]), annotations)

    const first = readRows(spokenByAlice, "json-annotations", "annotations")[0]
    const second = readRows(spokenByBob, "json-annotations", "annotations")[0]
    const firstAgain = readRows(spokenByAlice, "json-annotations", "annotations")[0]

    expect(first.inferred_meta).toEqual({ person: ["alice"] })
    expect(second.inferred_meta).toEqual({ person: ["bob"] })
    expect(firstAgain.inferred_meta).toEqual({ person: ["alice"] })
  })

  it("scopes each annotation row to its own span, not to the block's position", () => {
    const raw = document(
      regionsBlock([personRegion("alice", 1, 2), personRegion("bob", 3, 4)]),
      annotationsBlock([
        annotation(ALICE_SPOKE, "a1"),
        annotation(ACROSS_SPEAKERS, "a2"),
        annotation(BOB_SPOKE, "a3"),
      ])
    )

    const rows = readRows(raw, "json-annotations", "annotations")

    expect(rows.map((r) => r.inferred_meta)).toEqual([
      { person: ["alice"] },
      { person: ["alice", "bob"] },
      { person: ["bob"] },
    ])
  })

  it("leaves an annotation whose text is gone undecorated, and its neighbours alone", () => {
    const raw = document(
      regionsBlock([personRegion("alice", 0, 4)]),
      annotationsBlock([annotation(ABSENT, "a1"), annotation(ALICE_SPOKE, "a2")])
    )

    const rows = readRows(raw, "json-annotations", "annotations")

    expect(rows[0].inferred_meta).toBeUndefined()
    expect(rows[1].inferred_meta).toEqual({ person: ["alice"] })
  })

  it("leaves a block sitting in a gap between regions undecorated", () => {
    const raw = [
      "# Interview",
      "",
      "Alice said the funding was approved.",
      "",
      "She thanked the committee.",
      "",
      calloutBlock("callout-1"),
      "",
      "Bob objected to the timeline. He asked for another month.",
      "",
      regionsBlock([personRegion("alice", 1, 1), personRegion("bob", 3, 4)]),
      "",
    ].join("\n")

    const callouts = getBlocks(raw, "json-callout", schemaOf("json-callout"))

    expect(callouts[0].inferred_meta).toBeUndefined()
  })

  it("decorates a positional block from the region its own position sits in", () => {
    const raw = [
      TRANSCRIPT_PROSE,
      "",
      chartBlock("chart-1"),
      "",
      regionsBlock([dateRegion("2026-03-03T00:00:00Z", 0, 4)]),
      "",
    ].join("\n")

    const charts = getBlocks(raw, "json-chart", schemaOf("json-chart"))

    expect(charts[0].inferred_meta).toEqual({
      date: {
        start: "2026-03-03T00:00:00Z",
        end: "2026-03-03T00:00:00Z",
        when: "2026-03-03T00:00:00Z",
      },
    })
  })

  it("spans the whole document for a singleton with no rows", () => {
    const raw = document(
      regionsBlock([
        dateRegion("2026-03-05T00:00:00Z", 2, 2),
        dateRegion("2026-03-01T00:00:00Z", 0, 1),
        dateRegion("2026-03-09T00:00:00Z", 3, 4),
      ]),
      attributesBlock()
    )

    expect(readSingleton(raw, "json-attributes").inferred_meta).toEqual({
      date: {
        start: "2026-03-01T00:00:00Z",
        end: "2026-03-09T00:00:00Z",
        when: "2026-03-05T00:00:00Z",
      },
    })
  })

  it("omits the key of a kind with no region in scope", () => {
    const raw = document(regionsBlock([personRegion("alice", 0, 4)]), attributesBlock())

    const meta = readSingleton(raw, "json-attributes").inferred_meta

    expect(meta).toEqual({ person: ["alice"] })
    expect(meta).not.toHaveProperty("date")
  })

  it("ignores a stale region and a hit with no range", () => {
    const raw = document(
      regionsBlock([personRegion("alice", 40, 41), personRegion("bob")]),
      annotationsBlock([annotation(ALICE_SPOKE, "a1")])
    )

    const rows = readRows(raw, "json-annotations", "annotations")

    expect(rows[0].inferred_meta).toBeUndefined()
  })

  it("decorates a region row across kinds and never with its own kind", () => {
    const raw = document(
      regionsBlock([personRegion("alice", 1, 2), dateRegion("2026-03-03T00:00:00Z", 0, 4)])
    )

    const rows = readRows(raw, "json-regions", "regions")
    const personRow = rows.find((r) => r.kind === "person")

    expect(personRow?.inferred_meta).toEqual({
      date: {
        start: "2026-03-03T00:00:00Z",
        end: "2026-03-03T00:00:00Z",
        when: "2026-03-03T00:00:00Z",
      },
    })
  })

  it("decorates two byte-identical blocks from their own positions", () => {
    const raw = [
      "# Interview",
      "",
      "Alice said the funding was approved.",
      "",
      calloutBlock("callout-1"),
      "",
      "She thanked the committee.",
      "",
      "Bob objected to the timeline. He asked for another month.",
      "",
      calloutBlock("callout-1"),
      "",
      regionsBlock([personRegion("alice", 1, 1), personRegion("bob", 3, 4)]),
      "",
    ].join("\n")

    const callouts = getBlocks(raw, "json-callout", schemaOf("json-callout"))

    expect(callouts.map((c) => c.inferred_meta)).toEqual([
      { person: ["alice"] },
      { person: ["bob"] },
    ])
  })

  it("hands a block read twice the same decorated value", () => {
    const raw = document(
      regionsBlock([personRegion("alice", 0, 4)]),
      annotationsBlock([annotation(ALICE_SPOKE, "a1")])
    )

    expect(readSingleton(raw, "json-annotations")).toBe(readSingleton(raw, "json-annotations"))
  })

  it("decorates nothing in a document with no regions block", () => {
    const raw = document(
      annotationsBlock([annotation(ALICE_SPOKE, "a1")]),
      attributesBlock(),
      chartBlock("chart-1")
    )

    expect(readRows(raw, "json-annotations", "annotations")[0].inferred_meta).toBeUndefined()
    expect(readSingleton(raw, "json-attributes").inferred_meta).toBeUndefined()
    expect(getBlocks(raw, "json-chart", schemaOf("json-chart"))[0].inferred_meta).toBeUndefined()
  })
})
