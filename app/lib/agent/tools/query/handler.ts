import type { ToolResult } from "../../types"
import { QueryArgs } from "./def"
import { registerSpecialHandler } from "../../executors/delegation"
import { getDatabase } from "~/domain/db/database"
import { getLlmHost } from "~/lib/agent/env"
import { executeHybridLocal } from "~/lib/search/execute"
import { resolveSemanticSql } from "~/lib/search/resolve-semantic"
import {
  sanitizeSemanticError,
  SEMANTIC_ABSENCE_HINT,
  type HybridSearchPlan,
} from "~/lib/search/semantic"
import { capLimit, hasOffset, dropOffset, type LimitRewrite } from "~/lib/search/paging"
import { buildSemanticContext } from "~/domain/corpus/init"
import { getFiles } from "~/lib/files/store"

const MAX_QUERY_ROWS = 50

interface HybridRewrite {
  plan: HybridSearchPlan
  offsetDropped: boolean
  requestedLimit: number | undefined
  effectiveLimit: number
}

const formatRows = <T>(rows: T[]): string => JSON.stringify(rows, null, 2)

const plainSuffix = (rewrite: LimitRewrite, resultCount: number): string => {
  if (rewrite.kind === "unchanged") return ""
  if (resultCount < rewrite.effective) return ""
  if (rewrite.kind === "injected") {
    return `\n(no LIMIT specified — returning first ${rewrite.effective} rows. Add LIMIT/OFFSET to paginate or GROUP BY/COUNT to aggregate.)`
  }
  return `\n(LIMIT ${rewrite.requested} capped to ${rewrite.effective} — first ${rewrite.effective} rows shown. Use OFFSET ${rewrite.effective} to continue.)`
}

const planHybridWithCap = (sql: string, plan: HybridSearchPlan, max: number): HybridRewrite => {
  const offsetDropped = hasOffset(sql)
  const requestedLimit = plan.limit
  const effectiveLimit = Math.min(requestedLimit ?? max, max)
  const cleanBaseSql = offsetDropped ? dropOffset(plan.baseSql) : plan.baseSql
  return {
    plan: { ...plan, baseSql: cleanBaseSql, limit: effectiveLimit },
    offsetDropped,
    requestedLimit,
    effectiveLimit,
  }
}

const hybridSuffix = (rewrite: HybridRewrite, resultCount: number): string => {
  if (rewrite.offsetDropped) {
    return `\n(OFFSET dropped — semantic ranking is not paginatable. Showing top ${rewrite.effectiveLimit} matches. Refine SEMANTIC('...') or add WHERE filters to find different results.)`
  }
  const wantedMore =
    rewrite.requestedLimit === undefined || rewrite.requestedLimit > rewrite.effectiveLimit
  const filled = resultCount >= rewrite.effectiveLimit
  if (wantedMore && filled) {
    return `\n(showing top ${rewrite.effectiveLimit} semantic matches — ranking is automatic. Refine SEMANTIC('...') or add WHERE filters for different results.)`
  }
  return ""
}

const executeQuery = async (call: { args: unknown }): Promise<ToolResult<unknown>> => {
  const parsed = QueryArgs.safeParse(call.args)
  if (!parsed.success) return { status: "error", output: `Invalid args: ${parsed.error.message}` }

  const db = getDatabase()
  if (!db) return { status: "error", output: "Database not ready. Try again shortly." }

  const ctx = await buildSemanticContext(db, getLlmHost())

  const resolved = await resolveSemanticSql(parsed.data.sql, ctx)
  if (!resolved.ok) return { status: "error", output: resolved.error.message }

  if (resolved.value.type === "hybrid") {
    const rewrite = planHybridWithCap(parsed.data.sql, resolved.value.plan, MAX_QUERY_ROWS)
    const result = await executeHybridLocal(db, rewrite.plan, getFiles())
    if (!result.ok) return { status: "error", output: sanitizeSemanticError(result.error.message) }
    const hits = result.value
    return {
      status: "ok",
      output: formatRows(hits) + hybridSuffix(rewrite, hits.length) + SEMANTIC_ABSENCE_HINT,
    }
  }

  const rewrite = capLimit(resolved.value.sql, MAX_QUERY_ROWS)
  const result = await db.query<Record<string, unknown>>(rewrite.sql)
  if (!result.ok) return { status: "error", output: sanitizeSemanticError(result.error.message) }
  return {
    status: "ok",
    output: formatRows(result.value.rows) + plainSuffix(rewrite, result.value.rows.length),
  }
}

registerSpecialHandler("query", executeQuery)
