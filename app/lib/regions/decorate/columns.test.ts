import { describe, it, expect } from "vitest"
import { getProjections, toJsonSchema } from "~/domain/db/projections"
import { getDatabaseSchema } from "~/domain/db/database"
import { jsonSchemaToTableProjection } from "~/lib/db/ddl"
import { extractRows } from "~/lib/db/extract"
import { coerceValue } from "~/lib/db/arrow"
import type { DbColumn, JsonSchema } from "~/lib/db/types"
import type { ProjectionConfig } from "~/lib/db/projection"
import {
  TRANSCRIPT_PROSE,
  annotationsBlock,
  calloutBlock,
  chartBlock,
  dateRegion,
  document,
  regionsBlock,
  speakerRegion,
} from "./test-fixtures"

const DECORATED_COLUMNS: DbColumn[] = [
  { name: "inferred_meta_speaker", type: "VARCHAR[]", nullable: true },
  { name: "inferred_meta_date_start", type: "TIMESTAMP", nullable: true },
  { name: "inferred_meta_date_end", type: "TIMESTAMP", nullable: true },
  { name: "inferred_meta_date_when", type: "TIMESTAMP", nullable: true },
]

const projectionFor = (language: string): ProjectionConfig => {
  const found = getProjections().find((p) => p.language === language)
  if (!found) throw new Error(`no projection for ${language}`)
  return found
}

const tablesFor = (language: string) => {
  const projection = projectionFor(language)
  return jsonSchemaToTableProjection(projection.tableName, toJsonSchema(projection))
}

describe("decorated columns", () => {
  const decorated = [
    "json-annotations",
    "json-attributes",
    "json-callout",
    "json-chart",
    "json-regions",
  ]

  it.each(decorated)("%s carries the decorated columns and no child table for them", (language) => {
    const { schemas } = tablesFor(language)
    const [root] = schemas

    expect(root.columns).toEqual(expect.arrayContaining(DECORATED_COLUMNS))
    expect(schemas.map((s) => s.name)).not.toContain(`${root.name}_inferred_meta`)
  })

  it("leaves a projection restricted to a prose-less file undecorated", () => {
    const { schemas } = tablesFor("json-settings")

    expect(schemas.flatMap((s) => s.columns.map((c) => c.name))).not.toContain(
      "inferred_meta_speaker"
    )
  })

  it("describes charts to the agent without the spec column", () => {
    const described = getDatabaseSchema()
    const chartsTable = described.split("\n\n").find((t) => t.startsWith("charts\n"))

    expect(chartsTable).toBeDefined()
    expect(chartsTable).toContain("inferred_meta_date_start TIMESTAMP")
    expect(chartsTable).not.toMatch(/^ {2}spec /m)
  })
})

describe("decorated rows", () => {
  const projection = projectionFor("json-chart")
  const schema = (): JsonSchema => toJsonSchema(projection)

  const chartDocument = (regions: string): string =>
    [TRANSCRIPT_PROSE, "", chartBlock("chart-1"), "", regions, ""].join("\n")

  it("lands a decorated value under each flattened column name", () => {
    const raw = chartDocument(
      regionsBlock([speakerRegion("alice", 0, 4), dateRegion("2026-03-03T00:00:00Z", 0, 4)])
    )
    const [chart] = projection.blockParser(raw)

    const [{ table, rows }] = extractRows(projection.tableName, schema(), chart, "interview.md")

    expect(table).toBe("charts")
    expect(rows).toHaveLength(1)
    expect(rows[0].inferred_meta_speaker).toEqual(["alice"])
    expect(coerceValue("TIMESTAMP", rows[0].inferred_meta_date_start)).toEqual(
      new Date("2026-03-03T00:00:00Z")
    )
    expect(coerceValue("TIMESTAMP", rows[0].inferred_meta_date_end)).toEqual(
      new Date("2026-03-03T00:00:00Z")
    )
    expect(coerceValue("TIMESTAMP", rows[0].inferred_meta_date_when)).toEqual(
      new Date("2026-03-03T00:00:00Z")
    )
  })

  it("counts one row per chart block", () => {
    const raw = [
      TRANSCRIPT_PROSE,
      "",
      chartBlock("chart-1"),
      "",
      chartBlock("chart-2"),
      "",
      regionsBlock([dateRegion("2026-03-03T00:00:00Z", 0, 4)]),
      "",
    ].join("\n")

    expect(projection.blockParser(raw)).toHaveLength(2)
  })
})

describe("an undecorated row", () => {
  const NULL_COLUMNS = {
    inferred_meta_speaker: null,
    inferred_meta_date_start: null,
    inferred_meta_date_end: null,
    inferred_meta_date_when: null,
  }

  const inAGap = [
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
    regionsBlock([speakerRegion("alice", 1, 1), speakerRegion("bob", 3, 4)]),
    "",
  ].join("\n")

  const textIsGone = document(
    regionsBlock([speakerRegion("alice", 0, 4)]),
    annotationsBlock([{ text: "Carol proposed a vote", reason: "r", color: "blue" }])
  )

  const neverScanned = document(
    annotationsBlock([{ text: "the funding was approved", reason: "r", color: "blue" }])
  )

  interface Case {
    name: string
    language: string
    raw: string
    expected: Record<string, unknown>
  }

  const cases: Case[] = [
    {
      name: "a block sitting in a gap between regions",
      language: "json-callout",
      raw: inAGap,
      expected: { ...NULL_COLUMNS, id: "callout-1", title: "Aside" },
    },
    {
      name: "a row whose quoted text the document no longer holds",
      language: "json-annotations",
      raw: textIsGone,
      expected: { ...NULL_COLUMNS, text: "Carol proposed a vote", reason: "r" },
    },
    {
      name: "a row in a document that was never scanned",
      language: "json-annotations",
      raw: neverScanned,
      expected: { ...NULL_COLUMNS, text: "the funding was approved", color: "blue" },
    },
  ]

  it.each(cases)("$name projects null in every decorated column", ({ language, raw, expected }) => {
    const projection = projectionFor(language)
    const [row] = projection.blockParser(raw)

    const [{ rows }] = extractRows(
      projection.tableName,
      toJsonSchema(projection),
      row,
      "interview.md"
    )

    expect(rows[0]).toMatchObject(expected)
  })
})

describe("the attributes row's document span", () => {
  const projection = projectionFor("json-attributes")

  it("holds the earliest and latest date regions as instants", () => {
    const raw = document(
      regionsBlock([
        dateRegion("2026-03-05T00:00:00Z", 2, 2),
        dateRegion("2026-03-01T00:00:00Z", 0, 1),
      ]),
      "```json-attributes\n{}\n```"
    )
    const [attributes] = projection.blockParser(raw)

    const [{ rows }] = extractRows(
      projection.tableName,
      toJsonSchema(projection),
      attributes,
      "interview.md"
    )

    expect(coerceValue("TIMESTAMP", rows[0].inferred_meta_date_start)).toEqual(
      new Date("2026-03-01T00:00:00Z")
    )
    expect(coerceValue("TIMESTAMP", rows[0].inferred_meta_date_end)).toEqual(
      new Date("2026-03-05T00:00:00Z")
    )
    expect(coerceValue("TIMESTAMP", rows[0].inferred_meta_date_when)).toEqual(
      new Date("2026-03-05T00:00:00Z")
    )
  })
})
