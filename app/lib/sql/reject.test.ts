import { describe, it, expect } from "vitest"
import {
  rejectCase,
  rejectConcatOperator,
  rejectStringFormatting,
  rejectSqlPatterns,
} from "./reject"

describe("rejectCase", () => {
  const cases: { name: string; sql: string; rejected: boolean }[] = [
    { name: "plain select passes", sql: "SELECT file FROM files", rejected: false },
    {
      name: "CASE WHEN rejected",
      sql: "SELECT CASE WHEN file = 'a' THEN 'red' END AS color FROM t",
      rejected: true,
    },
    {
      name: "lowercase case rejected",
      sql: "select case when x then 1 end from t",
      rejected: true,
    },
    {
      name: "column named showcase passes",
      sql: "SELECT showcase FROM t",
      rejected: false,
    },
    {
      name: "column named casework passes",
      sql: "SELECT casework FROM t",
      rejected: false,
    },
  ]

  it.each(cases)("$name", ({ sql, rejected }) => {
    const errors = rejectCase(sql)
    expect(errors.length > 0).toBe(rejected)
  })
})

describe("rejectConcatOperator", () => {
  const cases: { name: string; sql: string; rejected: boolean }[] = [
    { name: "plain select passes", sql: "SELECT file FROM t", rejected: false },
    { name: "|| concat rejected", sql: "SELECT a || b FROM t", rejected: true },
    {
      name: "|| in a join condition rejected",
      sql: "SELECT x FROM t WHERE a = b || c",
      rejected: true,
    },
  ]

  it.each(cases)("$name", ({ sql, rejected }) => {
    expect(rejectConcatOperator(sql).length > 0).toBe(rejected)
  })
})

describe("rejectStringFormatting", () => {
  const cases: { name: string; sql: string; rejected: boolean; contains?: string }[] = [
    { name: "plain select passes", sql: "SELECT file FROM t", rejected: false },
    {
      name: "concat rejected",
      sql: "SELECT concat('File: ', name) FROM t",
      rejected: true,
      contains: "concat",
    },
    {
      name: "concat_ws rejected",
      sql: "SELECT concat_ws(' - ', a, b) FROM t",
      rejected: true,
      contains: "concat_ws",
    },
    {
      name: "printf rejected",
      sql: "SELECT printf('%s: %d', name, count) FROM t",
      rejected: true,
      contains: "printf",
    },
    {
      name: "format rejected",
      sql: "SELECT format('{} - {}', a, b) FROM t",
      rejected: true,
      contains: "format",
    },
    {
      name: "lower rejected",
      sql: "SELECT lower(name) FROM t",
      rejected: true,
      contains: "lower",
    },
    {
      name: "upper in WHERE rejected",
      sql: "SELECT name FROM t WHERE upper(name) = 'X'",
      rejected: true,
      contains: "upper",
    },
    {
      name: "substring rejected",
      sql: "SELECT substring(name, 1, 5) FROM t",
      rejected: true,
      contains: "substring",
    },
    {
      name: "replace rejected",
      sql: "SELECT replace(name, '_', ' ') FROM t",
      rejected: true,
      contains: "replace",
    },
    {
      name: "regexp_replace rejected",
      sql: "SELECT regexp_replace(name, '[0-9]', '') FROM t",
      rejected: true,
      contains: "regexp_replace",
    },
    {
      name: "trim rejected",
      sql: "SELECT trim(name) FROM t",
      rejected: true,
      contains: "trim",
    },
    {
      name: "multiple functions reported together",
      sql: "SELECT lower(concat(a, b)) FROM t",
      rejected: true,
      contains: "lower",
    },
    {
      name: "column named concat_id passes",
      sql: "SELECT concat_id FROM t",
      rejected: false,
    },
    {
      name: "column named trimmer passes",
      sql: "SELECT trimmer FROM t",
      rejected: false,
    },
  ]

  it.each(cases)("$name", ({ sql, rejected, contains }) => {
    const errors = rejectStringFormatting(sql)
    expect(errors.length > 0).toBe(rejected)
    if (contains) expect(errors[0]).toContain(contains)
  })
})

describe("rejectSqlPatterns", () => {
  it("combines CASE and string formatting errors", () => {
    const sql = "SELECT CASE WHEN a THEN lower(b) END FROM t"
    const errors = rejectSqlPatterns(sql)
    expect(errors).toHaveLength(2)
  })

  it("returns empty for clean SQL", () => {
    expect(rejectSqlPatterns("SELECT a, b FROM t WHERE x = 1")).toEqual([])
  })
})
