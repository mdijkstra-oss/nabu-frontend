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
      sql: "SELECT * FROM annotations WHERE callout_id = 'callout-1abcdef2'",
      prefixes,
      expected: ["callout-1abcdef2"],
    },
    {
      name: "finds multiple IDs across clauses",
      sql: "SELECT * FROM t WHERE a = 'tag-1xy2z3w4' AND b = 'search-9abc0def'",
      prefixes,
      expected: ["tag-1xy2z3w4", "search-9abc0def"],
    },
    {
      name: "finds ID in JOIN condition",
      sql: "SELECT * FROM a JOIN b ON a.id = 'chart-1a2b3c4d' WHERE 1=1",
      prefixes,
      expected: ["chart-1a2b3c4d"],
    },
    {
      name: "deduplicates repeated IDs",
      sql: "SELECT 'callout-1abcdef2', 'callout-1abcdef2' FROM t",
      prefixes,
      expected: ["callout-1abcdef2"],
    },
    {
      name: "ignores suffix without leading digit",
      sql: "SELECT * FROM t WHERE id = 'callout-abcdefgh'",
      prefixes,
      expected: [],
    },
    {
      name: "ignores strings with unknown prefix",
      sql: "SELECT * FROM t WHERE id = 'unknown-1abcdef2'",
      prefixes,
      expected: [],
    },
    {
      name: "ignores suffix too short (5 chars)",
      sql: "SELECT * FROM t WHERE id = 'callout-1a2b3'",
      prefixes,
      expected: [],
    },
    {
      name: "ignores suffix too short (6 chars)",
      sql: "SELECT * FROM t WHERE id = 'tag-1a2b3c'",
      prefixes,
      expected: [],
    },
    {
      name: "ignores suffix too long (10 chars)",
      sql: "SELECT * FROM t WHERE id = 'tag-1a2b3c4d5e'",
      prefixes,
      expected: [],
    },
    {
      name: "ignores suffix too long (11 chars)",
      sql: "SELECT * FROM t WHERE id = 'callout-1a2b3c4d5e6'",
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
      sql: "SELECT * FROM t WHERE id = 'callout-1abcdef2'",
      prefixes: [],
      expected: [],
    },
    {
      name: "does not match suffix with uppercase",
      sql: "SELECT * FROM t WHERE id = 'callout-1ABCDEF2'",
      prefixes,
      expected: [],
    },
    {
      name: "does not extend match into trailing alphanumeric",
      sql: "SELECT * FROM t WHERE id = 'callout-1abcdef2extra'",
      prefixes,
      expected: [],
    },
    {
      name: "finds ID not wrapped in quotes",
      sql: "callout-1abcdef2",
      prefixes,
      expected: ["callout-1abcdef2"],
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
      sql: "SELECT * FROM t WHERE id = 'callout-1abcdef2'",
      knownIds: ["callout-1abcdef2"],
      expectedCount: 0,
    },
    {
      name: "unknown ID fails with message",
      sql: "SELECT * FROM t WHERE id = 'callout-1abcdef2'",
      knownIds: [],
      expectedCount: 1,
      containsId: "callout-1abcdef2",
    },
    {
      name: "mix of known and unknown",
      sql: "SELECT * FROM t WHERE a = 'callout-1abcdef2' AND b = 'tag-1xy2z3w4'",
      knownIds: ["callout-1abcdef2"],
      expectedCount: 1,
      containsId: "tag-1xy2z3w4",
    },
    {
      name: "no IDs in SQL returns empty",
      sql: "SELECT count(*) FROM annotations",
      knownIds: ["callout-1abcdef2"],
      expectedCount: 0,
    },
    {
      name: "multiple unknown IDs",
      sql: "SELECT 'callout-1abcdef2', 'tag-1xy2z3w4' FROM t",
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
        "doc.md": `# Doc\n\n${block("json-callout", makeCallout("callout-1abcdef2"))}`,
      },
      expected: ["callout-1abcdef2"],
    },
    {
      name: "collects chart IDs",
      files: {
        "doc.md": `# Doc\n\n${block("json-chart", makeChart("chart-1xy2z3w4"))}`,
      },
      expected: ["chart-1xy2z3w4"],
    },
    {
      name: "collects annotation IDs",
      files: {
        "doc.md": `# Doc\n\n${block("json-annotations", makeAnnotations([{ text: "hello", color: "red", reason: "test", id: "ann-1a2b3c4d" }]))}`,
      },
      expected: ["ann-1a2b3c4d"],
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
                id: "tag-1a2b3c4d",
                label: "test",
                display: "Test",
                color: "red",
                icon: "activity",
              },
            ],
            [
              {
                id: "search-1xy2z3w4",
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
      expected: ["tag-1a2b3c4d", "search-1xy2z3w4"],
    },
    {
      name: "collects across multiple files",
      files: {
        "a.md": `# A\n\n${block("json-callout", makeCallout("callout-1abcdef2"))}`,
        "b.md": `# B\n\n${block("json-chart", makeChart("chart-1xy2z3w4"))}`,
      },
      expected: ["callout-1abcdef2", "chart-1xy2z3w4"],
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
