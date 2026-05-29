import type { Result } from "~/lib/fp/result"
import type { SearchHit, HydesCache } from "~/domain/search/types"
import type { HydeQuery, HybridSearchPlan } from "./semantic"
import type { SemanticContext } from "./resolve-semantic"
import type { FileStore } from "~/lib/files/store"
import { ok, err } from "~/lib/fp/result"
import { resolveSemanticSql } from "./resolve-semantic"
import { executeSearch, executeHybridLocal } from "./execute"
import { sanitizeSemanticError, sqlQueriesFilesTable } from "./semantic"
import { filterParallel, FILTER_BATCH_SIZE } from "./filter-hits"
import { growHits } from "./slices"

export const MAX_BARREN_BATCHES = 5

export interface PipelineResult {
  hits: SearchHit[]
  rawRemaining: SearchHit[]
  hydes: HydeQuery[]
  isSemantic: boolean
  hydesCache?: HydesCache
  descriptionsHash?: string
  needsFiltering: boolean
  exhausted: boolean
}

export interface PipelineError {
  message: string
}

export const sortByScore = (hits: SearchHit[]): SearchHit[] =>
  [...hits].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

const resolveAndExecutePlain = async (sql: string, ctx: SemanticContext) => {
  const rawHits = await executeSearch(ctx.db, sql)
  if (!rawHits.ok)
    return { ok: false as const, error: { message: sanitizeSemanticError(rawHits.error.message) } }
  return {
    ok: true as const,
    rawHits: rawHits.value,
    hydes: [] as HydeQuery[],
    isSemantic: false,
    hydesCache: undefined,
    descriptionsHash: undefined,
  }
}

const resolveAndExecuteHybrid = async (
  plan: HybridSearchPlan,
  hydesCache: HydesCache,
  descriptionsHash: string,
  ctx: SemanticContext
) => {
  const rawHits = await executeHybridLocal(ctx.db, plan)
  if (!rawHits.ok)
    return { ok: false as const, error: { message: sanitizeSemanticError(rawHits.error.message) } }
  return {
    ok: true as const,
    rawHits: rawHits.value,
    hydes: plan.hydes,
    isSemantic: true,
    hydesCache,
    descriptionsHash,
  }
}

const resolveAndExecute = async (sql: string, ctx: SemanticContext) => {
  const resolved = await resolveSemanticSql(sql, ctx)
  if (!resolved.ok) return { ok: false as const, error: { message: resolved.error.message } }

  if (resolved.value.type === "plain") return resolveAndExecutePlain(resolved.value.sql, ctx)

  return resolveAndExecuteHybrid(
    resolved.value.plan,
    resolved.value.hydesCache,
    resolved.value.descriptionsHash,
    ctx
  )
}

const buildEmptyResult = (
  hydes: HydeQuery[],
  isSemantic: boolean,
  hydesCache?: HydesCache,
  descriptionsHash?: string
): PipelineResult => ({
  hits: [],
  rawRemaining: [],
  hydes,
  isSemantic,
  hydesCache,
  descriptionsHash,
  needsFiltering: false,
  exhausted: true,
})

const filterWithBudget = async (
  rawHits: SearchHit[],
  highlight: string,
  files: FileStore,
  target: number,
  onResults?: (hits: SearchHit[]) => void
) => {
  const collected: SearchHit[] = []
  const collectAndForward = (batch: SearchHit[]) => {
    collected.push(...batch)
    onResults?.(batch)
  }

  const { consumed, barren } = await filterParallel(rawHits, highlight, files, collectAndForward, {
    target,
    maxBarren: MAX_BARREN_BATCHES,
  })

  const rawConsumed = Math.min(consumed * FILTER_BATCH_SIZE, rawHits.length)
  const rawRemaining = rawHits.slice(rawConsumed)
  const exhausted = rawRemaining.length === 0 || barren

  return { hits: sortByScore(collected), rawRemaining, exhausted }
}

export const runSearchPipeline = async (
  sql: string,
  highlight: string,
  ctx: SemanticContext,
  files: FileStore,
  target: number,
  onResults?: (hits: SearchHit[]) => void
): Promise<Result<PipelineResult, PipelineError>> => {
  const resolved = await resolveAndExecute(sql, ctx)
  if (!resolved.ok) return err(resolved.error)

  const { rawHits, hydes, isSemantic, hydesCache, descriptionsHash } = resolved

  if (rawHits.length === 0)
    return ok(buildEmptyResult(hydes, isSemantic, hydesCache, descriptionsHash))

  const needsFiltering = sqlQueriesFilesTable(sql)

  if (!needsFiltering) {
    const hits = growHits(rawHits, files)
    onResults?.(hits)
    return ok({
      hits,
      rawRemaining: [],
      hydes,
      isSemantic,
      hydesCache,
      descriptionsHash,
      needsFiltering: false,
      exhausted: true,
    })
  }

  const filtered = await filterWithBudget(rawHits, highlight, files, target, onResults)

  return ok({
    ...filtered,
    hydes,
    isSemantic,
    hydesCache,
    descriptionsHash,
    needsFiltering: true,
  })
}
