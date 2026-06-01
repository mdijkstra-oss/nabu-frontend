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

export const chunkToHit = (chunk: ScoredChunk): SearchHit => ({
  file: chunk.file,
  ...(chunk.text !== undefined ? { text: chunk.text } : {}),
  score: chunk.score,
})

type QueryBuilder = (baseSql: string, hyde: HybridSearchPlan["hydes"][number]) => string

const fuseHydes = async (
  db: Database,
  plan: HybridSearchPlan,
  buildQuery: QueryBuilder,
  limit: number | undefined
): Promise<Result<ScoredChunk[], DbError>> => {
  const results = await Promise.all(
    plan.hydes.map((hyde) => runScoredQuery(db, buildQuery(plan.baseSql, hyde)))
  )

  const cosinePerHyde: ScoredChunk[][] = []
  for (const result of results) {
    if (!result.ok) return result
    cosinePerHyde.push(result.value)
  }

  return ok(fuseCosineResults(cosinePerHyde, limit))
}

export const executeHybridLocal = async (
  db: Database,
  plan: HybridSearchPlan
): Promise<Result<SearchHit[], DbError>> => {
  const fused = await fuseHydes(db, plan, buildCosineQuery, plan.limit)
  if (!fused.ok) return fused
  return ok(fused.value.map(chunkToHit))
}
