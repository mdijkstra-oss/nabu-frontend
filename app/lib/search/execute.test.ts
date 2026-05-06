import { describe, it, expect } from "vitest"
import { executeSearch } from "./execute"
import type { Database, QueryResult, DbError } from "~/lib/db/types"
import type { SearchHit } from "~/domain/search/types"
import type { Result } from "~/lib/fp/result"
import { ok, err } from "~/lib/fp/result"

type RawRow = Record<string, unknown>

const createTestDb = (
  handler: (sql: string) => Result<QueryResult<RawRow>, DbError>
): Database => ({
  instance: {} as Database["instance"],
  query: async <T = unknown>(sql: string) => handler(sql) as Result<QueryResult<T>, DbError>,
})

const successDb = (rows: RawRow[]): Database =>
  createTestDb(() => ok({ rows, rowCount: rows.length }))

const failDb = (error: DbError): Database => createTestDb(() => err(error))

interface TestCase {
  name: string
  db: Database
  sql: string
  expected: Result<SearchHit[], DbError>
}

const cases: TestCase[] = [
  {
    name: "file-only hits",
    db: successDb([{ file: "doc1.md" }, { file: "doc2.md" }]),
    sql: "SELECT file FROM files",
    expected: ok([{ file: "doc1.md" }, { file: "doc2.md" }]),
  },
  {
    name: "file + id hits",
    db: successDb([
      { file: "doc1.md", id: "annotation-abc" },
      { file: "doc2.md", id: "callout-def" },
    ]),
    sql: "SELECT file, id FROM callouts",
    expected: ok([
      { file: "doc1.md", id: "annotation-abc" },
      { file: "doc2.md", id: "callout-def" },
    ]),
  },
  {
    name: "file + text hits",
    db: successDb([
      { file: "doc1.md", text: "some relevant passage" },
      { file: "doc2.md", text: "another passage" },
    ]),
    sql: "SELECT file, text FROM annotations",
    expected: ok([
      { file: "doc1.md", text: "some relevant passage" },
      { file: "doc2.md", text: "another passage" },
    ]),
  },
  {
    name: "file + id + text hits",
    db: successDb([{ file: "doc1.md", id: "ann-1", text: "passage" }]),
    sql: "SELECT file, id, text FROM annotations",
    expected: ok([{ file: "doc1.md", id: "ann-1", text: "passage" }]),
  },
  {
    name: "empty result set",
    db: successDb([]),
    sql: "SELECT file FROM files WHERE 1=0",
    expected: ok([]),
  },
  {
    name: "missing file column returns error",
    db: successDb([{ name: "doc1.md" }]),
    sql: "SELECT name FROM files",
    expected: err({ type: "query", message: "Query must SELECT a `file` column" }),
  },
  {
    name: "db error propagates",
    db: failDb({ type: "query", message: "syntax error" }),
    sql: "INVALID SQL",
    expected: err({ type: "query", message: "syntax error" }),
  },
]

describe("executeSearch", () => {
  it.each(cases)("$name", async ({ db, sql, expected }) => {
    const result = await executeSearch(db, sql)
    expect(result).toEqual(expected)
  })
})
