import type { Result } from "~/lib/fp/result"
import type { SearchHit, EmbeddingsCache } from "~/domain/search/types"
import type { HydeQuery, HybridSearchPlan } from "./semantic"
import type { ResolvedQuery, SemanticContext } from "./resolve-semantic"
import type { FileStore } from "~/lib/files/store"
import type { Database } from "~/lib/db/types"
import { ok, err } from "~/lib/fp/result"
import { resolveSemanticSql } from "./resolve-semantic"
import { executeSearch, executeHybridLocal } from "./execute"
import { sanitizeSemanticError, sqlQueriesFilesTable } from "./semantic"
import { filterParallel, FILTER_BATCH_SIZE } from "./filter-hits"
import { growHits, attachAnnotationsOnly } from "./slices"
import { mergeOverlappingHits } from "./merge-overlapping"

export const MAX_BARREN_BATCHES = 10

export interface PipelineResult {
  hits: SearchHit[]
  rawRemaining: SearchHit[]
  hydes: HydeQuery[]
  isSemantic: boolean
  embeddings?: EmbeddingsCache
  highlight?: string
  needsFiltering: boolean
  exhausted: boolean
}

export interface PipelineError {
  message: string
}

export const sortByScore = (hits: SearchHit[]): SearchHit[] =>
  [...hits].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

export const mergeByScore = (sorted: SearchHit[], incoming: SearchHit[]): SearchHit[] => {
  const fresh = [...incoming].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const merged: SearchHit[] = []
  let si = 0
  let fi = 0
  while (si < sorted.length && fi < fresh.length) {
    if ((sorted[si].score ?? 0) >= (fresh[fi].score ?? 0)) merged.push(sorted[si++])
    else merged.push(fresh[fi++])
  }
  while (si < sorted.length) merged.push(sorted[si++])
  while (fi < fresh.length) merged.push(fresh[fi++])
  return merged
}

interface Executed {
  rawHits: SearchHit[]
  hydes: HydeQuery[]
  isSemantic: boolean
  embeddings?: EmbeddingsCache
  highlight?: string
}

const executePlain = async (
  sql: string,
  db: Database
): Promise<Result<Executed, PipelineError>> => {
  const result = await executeSearch(db, sql)
  if (!result.ok) return err({ message: sanitizeSemanticError(result.error.message) })
  return ok({ rawHits: result.value, hydes: [], isSemantic: false })
}

const executeHybrid = async (
  plan: HybridSearchPlan,
  embeddings: EmbeddingsCache,
  highlight: string | undefined,
  db: Database
): Promise<Result<Executed, PipelineError>> => {
  if (plan.hydes.length === 0)
    return err({ message: "Embedding resolution produced no search vectors" })

  const result = await executeHybridLocal(db, plan)
  if (!result.ok) return err({ message: sanitizeSemanticError(result.error.message) })
  return ok({ rawHits: result.value, hydes: plan.hydes, isSemantic: true, embeddings, highlight })
}

const dispatchExecution = (
  resolved: ResolvedQuery,
  db: Database
): Promise<Result<Executed, PipelineError>> =>
  resolved.type === "plain"
    ? executePlain(resolved.sql, db)
    : executeHybrid(resolved.plan, resolved.embeddings, resolved.highlight, db)

const filterWithBudget = async (
  rawHits: SearchHit[],
  highlight: string,
  signals: string[],
  files: FileStore,
  target: number,
  onResults?: (hits: SearchHit[]) => void,
  skipBarrenCheck = false
) => {
  const collected: SearchHit[] = []
  const collectAndForward = (batch: SearchHit[]) => {
    collected.push(...batch)
    onResults?.(batch)
  }

  const { consumed, barren } = await filterParallel(
    rawHits,
    highlight,
    signals,
    files,
    collectAndForward,
    {
      target,
      maxBarren: skipBarrenCheck ? undefined : MAX_BARREN_BATCHES,
    }
  )

  const rawConsumed = Math.min(consumed * FILTER_BATCH_SIZE, rawHits.length)
  const rawRemaining = rawHits.slice(rawConsumed)
  const exhausted = rawRemaining.length === 0 || barren

  return { hits: sortByScore(collected), rawRemaining, exhausted }
}

export const extractSignalTexts = (hydes: HydeQuery[]): string[] =>
  hydes.filter((h) => h.type === "signal").map((h) => h.text)

const buildResult = (
  executed: Executed,
  sql: string,
  highlight: string,
  files: FileStore,
  target: number,
  onResults?: (hits: SearchHit[]) => void,
  skipFilter = false,
  skipBarrenCheck = false
): Promise<Result<PipelineResult, PipelineError>> => {
  const { rawHits: rawUnmerged, hydes, isSemantic, embeddings } = executed
  const rawHits = skipFilter ? rawUnmerged : mergeOverlappingHits(rawUnmerged, files)
  const resolvedHighlight = executed.highlight

  if (rawHits.length === 0)
    return Promise.resolve(
      ok({
        hits: [],
        rawRemaining: [],
        hydes,
        isSemantic,
        embeddings,
        highlight: resolvedHighlight,
        needsFiltering: false,
        exhausted: true,
      })
    )

  if (skipFilter) {
    const hits = attachAnnotationsOnly(rawHits, files)
    onResults?.(hits)
    return Promise.resolve(
      ok({
        hits,
        rawRemaining: [],
        hydes,
        isSemantic,
        embeddings,
        highlight: resolvedHighlight,
        needsFiltering: false,
        exhausted: true,
      })
    )
  }

  const needsFiltering = sqlQueriesFilesTable(sql)

  if (!needsFiltering) {
    const hits = growHits(rawHits, files)
    onResults?.(hits)
    return Promise.resolve(
      ok({
        hits,
        rawRemaining: [],
        hydes,
        isSemantic,
        embeddings,
        highlight: resolvedHighlight,
        needsFiltering: false,
        exhausted: true,
      })
    )
  }

  const effectiveHighlight = resolvedHighlight || highlight
  if (!effectiveHighlight)
    return Promise.resolve(
      err({
        message: "Semantic filtering requires a highlight but none was resolved or provided",
      })
    )

  return filterWithBudget(
    rawHits,
    effectiveHighlight,
    extractSignalTexts(hydes),
    files,
    target,
    onResults,
    skipBarrenCheck
  ).then((filtered) =>
    ok({
      ...filtered,
      hydes,
      isSemantic,
      embeddings,
      highlight: resolvedHighlight,
      needsFiltering: true,
    })
  )
}

export const executeResolvedSearch = async (
  resolved: ResolvedQuery,
  sql: string,
  highlight: string,
  db: Database,
  files: FileStore,
  target: number,
  onResults?: (hits: SearchHit[]) => void,
  skipFilter = false,
  skipBarrenCheck = false
): Promise<Result<PipelineResult, PipelineError>> => {
  const executed = await dispatchExecution(resolved, db)
  if (!executed.ok) return err(executed.error)
  return buildResult(
    executed.value,
    sql,
    highlight,
    files,
    target,
    onResults,
    skipFilter,
    skipBarrenCheck
  )
}

export const runSearchPipeline = async (
  sql: string,
  highlight: string,
  ctx: SemanticContext,
  files: FileStore,
  target: number,
  onResults?: (hits: SearchHit[]) => void,
  skipFilter = false,
  skipBarrenCheck = false
): Promise<Result<PipelineResult, PipelineError>> => {
  const resolved = await resolveSemanticSql(sql, ctx)
  if (!resolved.ok) return err({ message: resolved.error.message })
  return executeResolvedSearch(
    resolved.value,
    sql,
    highlight,
    ctx.db,
    files,
    target,
    onResults,
    skipFilter,
    skipBarrenCheck
  )
}
