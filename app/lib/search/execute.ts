import type { Database, DbError } from "~/lib/db/types"
import type { SearchHit } from "~/domain/search/types"
import type { Result } from "~/lib/fp/result"
import type { HybridSearchPlan } from "./semantic"
import type { ScoredChunk } from "./fusion"
import { ok, err } from "~/lib/fp/result"
import { buildCosineQuery } from "./semantic"
import { fuseCosineResults } from "./fusion"

type RawRow = Record<string, unknown>

const hasFileColumn = (row: RawRow): boolean => "file" in row

const toHit = (row: RawRow): SearchHit => ({
  file: String(row.file),
  ...(row.id !== undefined ? { id: String(row.id) } : {}),
  ...(row.text !== undefined ? { text: String(row.text) } : {}),
})

export const executeSearch = async (
  db: Database,
  sql: string
): Promise<Result<SearchHit[], DbError>> => {
  const result = await db.query<RawRow>(sql)
  if (!result.ok) return result

  const rows = result.value.rows
  if (rows.length === 0) return ok([])

  if (!hasFileColumn(rows[0])) {
    return err({ type: "query", message: "Query must SELECT a `file` column" })
  }

  return ok(rows.map(toHit))
}

const toScoredChunk = (row: RawRow): ScoredChunk => ({
  file: String(row.file),
  text: row.text !== undefined ? String(row.text) : undefined,
  hash: row.hash !== undefined ? String(row.hash) : undefined,
  score: Number(row._semantic_score ?? 0),
})

const runScoredQuery = async (
  db: Database,
  sql: string
): Promise<Result<ScoredChunk[], DbError>> => {
  const result = await db.query<RawRow>(sql)
  if (!result.ok) return result
  return ok(result.value.rows.map(toScoredChunk))
}

const chunkToHit = (chunk: ScoredChunk): SearchHit => ({
  file: chunk.file,
  ...(chunk.text !== undefined ? { text: chunk.text } : {}),
})

export const executeHybridLocal = async (
  db: Database,
  plan: HybridSearchPlan
): Promise<Result<SearchHit[], DbError>> => {
  const cosinePerHyde: ScoredChunk[][] = []

  for (const hyde of plan.hydes) {
    const sql = buildCosineQuery(plan.baseSql, hyde)
    const result = await runScoredQuery(db, sql)
    if (!result.ok) return result
    cosinePerHyde.push(result.value)
  }

  const fused = fuseCosineResults(cosinePerHyde, plan.limit)
  return ok(fused.map(chunkToHit))
}
