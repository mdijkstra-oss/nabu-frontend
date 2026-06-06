import { describe, it, expect } from "vitest"
import { extractEntityIdsFromSql, collectAllEntityIds, validateSqlEntityReferences } from "./ids"
import { getCallouts } from "~/domain/data-blocks/callout/selectors"
import { getStoredAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import { getCharts } from "~/domain/data-blocks/chart/selectors"
import { getSettings } from "~/domain/data-blocks/settings/selectors"
import type { FileStore } from "~/lib/files/store"
import { block } from "./test-helpers"

describe("extractEntityIdsFromSql", () => {
  const prefixes = ["callout", "tag", "search", "ann", "chart"]

  const cases: {
    name: string
    sql: string
    prefixes: string[]
    expected: string[]
  }[] = [
    {
      name: "finds ID in WHERE clause",
      sql: "SELECT * FROM annotations WHERE callout_id = 'callout-abc1def2'",
      prefixes,
      expected: ["callout-abc1def2"],
    },
    {
      name: "finds multiple IDs across clauses",
      sql: "SELECT * FROM t WHERE a = 'tag-x1y2z3' AND b = 'search-9abc0def'",
      prefixes,
      expected: ["tag-x1y2z3", "search-9abc0def"],
    },
    {
      name: "finds ID in JOIN condition",
      sql: "SELECT * FROM a JOIN b ON a.id = 'chart-a1b2c3d4' WHERE 1=1",
      prefixes,
      expected: ["chart-a1b2c3d4"],
    },
    {
      name: "deduplicates repeated IDs",
      sql: "SELECT 'callout-abc1def2', 'callout-abc1def2' FROM t",
      prefixes,
      expected: ["callout-abc1def2"],
    },
    {
      name: "ignores strings without digit in suffix",
      sql: "SELECT * FROM t WHERE id = 'callout-abcdefgh'",
      prefixes,
      expected: [],
    },
    {
      name: "ignores strings with unknown prefix",
      sql: "SELECT * FROM t WHERE id = 'unknown-abc1def2'",
      prefixes,
      expected: [],
    },
    {
      name: "ignores suffix too short",
      sql: "SELECT * FROM t WHERE id = 'callout-a1b2c'",
      prefixes,
      expected: [],
    },
    {
      name: "ignores suffix too long",
      sql: "SELECT * FROM t WHERE id = 'callout-a1b2c3d4e5f'",
      prefixes,
      expected: [],
    },
    {
      name: "returns empty for no matches",
      sql: "SELECT count(*) FROM annotations",
      prefixes,
      expected: [],
    },
    {
      name: "returns empty for empty prefixes",
      sql: "SELECT * FROM t WHERE id = 'callout-abc1def2'",
      prefixes: [],
      expected: [],
    },
    {
      name: "handles ID at boundary of suffix length (6 chars)",
      sql: "SELECT * FROM t WHERE id = 'tag-a1b2c3'",
      prefixes,
      expected: ["tag-a1b2c3"],
    },
    {
      name: "handles ID at boundary of suffix length (10 chars)",
      sql: "SELECT * FROM t WHERE id = 'tag-a1b2c3d4e5'",
      prefixes,
      expected: ["tag-a1b2c3d4e5"],
    },
    {
      name: "does not match suffix with uppercase",
      sql: "SELECT * FROM t WHERE id = 'callout-Abc1def2'",
      prefixes,
      expected: [],
    },
    {
      name: "does not extend match into trailing alphanumeric",
      sql: "SELECT * FROM t WHERE id = 'callout-abc1def2extra'",
      prefixes,
      expected: [],
    },
    {
      name: "finds ID not wrapped in quotes",
      sql: "callout-abc1def2",
      prefixes,
      expected: ["callout-abc1def2"],
    },
  ]

  it.each(cases)("$name", ({ sql, prefixes, expected }) => {
    expect(extractEntityIdsFromSql(sql, prefixes)).toEqual(expected)
  })
})

describe("validateSqlEntityReferences", () => {
  const prefixes = ["callout", "tag"]

  const cases: {
    name: string
    sql: string
    knownIds: string[]
    expectedCount: number
    containsId?: string
  }[] = [
    {
      name: "all known IDs pass",
      sql: "SELECT * FROM t WHERE id = 'callout-abc1def2'",
      knownIds: ["callout-abc1def2"],
      expectedCount: 0,
    },
    {
      name: "unknown ID fails with message",
      sql: "SELECT * FROM t WHERE id = 'callout-abc1def2'",
      knownIds: [],
      expectedCount: 1,
      containsId: "callout-abc1def2",
    },
    {
      name: "mix of known and unknown",
      sql: "SELECT * FROM t WHERE a = 'callout-abc1def2' AND b = 'tag-x1y2z3'",
      knownIds: ["callout-abc1def2"],
      expectedCount: 1,
      containsId: "tag-x1y2z3",
    },
    {
      name: "no IDs in SQL returns empty",
      sql: "SELECT count(*) FROM annotations",
      knownIds: ["callout-abc1def2"],
      expectedCount: 0,
    },
    {
      name: "multiple unknown IDs",
      sql: "SELECT 'callout-abc1def2', 'tag-x1y2z3' FROM t",
      knownIds: [],
      expectedCount: 2,
    },
  ]

  it.each(cases)("$name", ({ sql, knownIds, expectedCount, containsId }) => {
    const result = validateSqlEntityReferences(sql, prefixes, new Set(knownIds))
    expect(result).toHaveLength(expectedCount)
    if (containsId) {
      expect(result.some((msg) => msg.includes(containsId))).toBe(true)
    }
  })
})

describe("collectAllEntityIds", () => {
  const makeCallout = (id: string) =>
    JSON.stringify({
      id,
      type: "codebook-code",
      title: "Test",
      content: "test",
      color: "red",
      collapsed: false,
    })

  const makeChart = (id: string) =>
    JSON.stringify({
      id,
      caption: { label: "Test Chart" },
      query: "SELECT 1",
      spec: { type: "bar", x: "month", y: "value", color: "blue" },
    })

  const makeAnnotations = (
    annotations: { text: string; color: string; reason: string; id?: string }[]
  ) => JSON.stringify({ annotations })

  const makeSettings = (
    tags: { id: string; label: string; display: string; color: string; icon: string }[],
    searches: {
      id: string
      title: string
      description: string
      sql: string
      saved: boolean
      createdAt: number
    }[]
  ) => JSON.stringify({ tags, searches, corpusDescriptions: [] })

  const extractors = [
    (raw: string) => getCallouts(raw).map((c) => c.id),
    (raw: string) => getStoredAnnotations(raw).flatMap((a) => (a.id ? [a.id] : [])),
    (raw: string) => getCharts(raw).map((c) => c.id),
    (raw: string) => {
      const s = getSettings(raw)
      return [...(s?.tags ?? []).map((t) => t.id), ...(s?.searches ?? []).map((e) => e.id)]
    },
  ]

  const cases: {
    name: string
    files: FileStore
    expected: string[]
  }[] = [
    {
      name: "collects callout IDs",
      files: {
        "doc.md": `# Doc\n\n${block("json-callout", makeCallout("callout-abc1def2"))}`,
      },
      expected: ["callout-abc1def2"],
    },
    {
      name: "collects chart IDs",
      files: {
        "doc.md": `# Doc\n\n${block("json-chart", makeChart("chart-x1y2z3w4"))}`,
      },
      expected: ["chart-x1y2z3w4"],
    },
    {
      name: "collects annotation IDs",
      files: {
        "doc.md": `# Doc\n\n${block("json-annotations", makeAnnotations([{ text: "hello", color: "red", reason: "test", id: "ann-a1b2c3d4" }]))}`,
      },
      expected: ["ann-a1b2c3d4"],
    },
    {
      name: "skips annotations without IDs",
      files: {
        "doc.md": `# Doc\n\n${block("json-annotations", makeAnnotations([{ text: "hello", color: "red", reason: "test" }]))}`,
      },
      expected: [],
    },
    {
      name: "collects tag and search IDs from settings",
      files: {
        "settings.md": `# Settings\n\n${block(
          "json-settings",
          makeSettings(
            [
              {
                id: "tag-a1b2c3d4",
                label: "test",
                display: "Test",
                color: "red",
                icon: "activity",
              },
            ],
            [
              {
                id: "search-x1y2z3w4",
                title: "Test",
                description: "test",
                sql: "SELECT 1",
                saved: true,
                createdAt: 1000,
              },
            ]
          )
        )}`,
      },
      expected: ["tag-a1b2c3d4", "search-x1y2z3w4"],
    },
    {
      name: "collects across multiple files",
      files: {
        "a.md": `# A\n\n${block("json-callout", makeCallout("callout-abc1def2"))}`,
        "b.md": `# B\n\n${block("json-chart", makeChart("chart-x1y2z3w4"))}`,
      },
      expected: ["callout-abc1def2", "chart-x1y2z3w4"],
    },
    {
      name: "returns empty for files with no entities",
      files: {
        "doc.md": "# Just prose\n\nNo blocks here.",
      },
      expected: [],
    },
  ]

  it.each(cases)("$name", ({ files, expected }) => {
    const result = collectAllEntityIds(files, extractors)
    expect(result).toEqual(new Set(expected))
  })
})
