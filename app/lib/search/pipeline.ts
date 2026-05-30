import type { Result } from "~/lib/fp/result"
import type { SearchHit, EmbeddingsCache } from "~/domain/search/types"
import type { HydeQuery, HybridSearchPlan } from "./semantic"
import type { SemanticContext } from "./resolve-semantic"
import type { FileStore } from "~/lib/files/store"
import type { Database } from "~/lib/db/types"
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
  const resolved = await resolveSemanticSql(sql, ctx)
  if (!resolved.ok) return err({ message: resolved.error.message })

  const executed =
    resolved.value.type === "plain"
      ? await executePlain(resolved.value.sql, ctx.db)
      : await executeHybrid(
          resolved.value.plan,
          resolved.value.embeddings,
          resolved.value.highlight,
          ctx.db
        )
  if (!executed.ok) return err(executed.error)

  const { rawHits, hydes, isSemantic, embeddings } = executed.value
  const resolvedHighlight = executed.value.highlight

  if (rawHits.length === 0)
    return ok({
      hits: [],
      rawRemaining: [],
      hydes,
      isSemantic,
      embeddings,
      highlight: resolvedHighlight,
      needsFiltering: false,
      exhausted: true,
    })

  const needsFiltering = sqlQueriesFilesTable(sql)

  if (!needsFiltering) {
    const hits = growHits(rawHits, files)
    onResults?.(hits)
    return ok({
      hits,
      rawRemaining: [],
      hydes,
      isSemantic,
      embeddings,
      highlight: resolvedHighlight,
      needsFiltering: false,
      exhausted: true,
    })
  }

  const effectiveHighlight = resolvedHighlight || highlight
  if (!effectiveHighlight)
    return err({
      message: "Semantic filtering requires a highlight but none was resolved or provided",
    })

  const filtered = await filterWithBudget(rawHits, effectiveHighlight, files, target, onResults)

  return ok({
    ...filtered,
    hydes,
    isSemantic,
    embeddings,
    highlight: resolvedHighlight,
    needsFiltering: true,
  })
}
