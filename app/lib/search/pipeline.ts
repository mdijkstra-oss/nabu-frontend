// Search pipeline — linear chain.
//
//   probe                → SearchHit[]   (Stage 1)                            raw chunk hits from vector search
//   capStage             → SearchHit[]   (Stage 2)                            cap per file (always; limiting, not merging)
//   mergeStage           → SearchHit[]   (Stage 3)  [skipMerge]               seed-and-grow (score-ratio gate) + reslice from source
//   verdict              → SearchHit[]   (Stage 4)  [skipFilter]              streaming LLM filter, attaches matchRanges
//   trim                 → SearchHit[]   (Stage 5)  [skipTrim]                trim within hit.text using matchRanges
//   extendForAnnotations → SearchHit[]   (Stage 6)  [skipAnnotationExtend]    grow byte range to swallow overlapping annotations
//
// Each stage lives in its own file. Toggles short-circuit a stage to a pass-through.
// verdict is the only async/batched/streaming step; per-batch tail (trim → extend) fires via onResults.

import type { Result } from "~/lib/fp/result"
import type { SearchHit, EmbeddingsCache } from "~/domain/search/types"
import type { HydeQuery } from "./semantic"
import type { SemanticContext, ResolvedQuery } from "./resolve-semantic"
import type { FileStore } from "~/lib/files/store"
import type { Database } from "~/lib/db/types"
import { ok, err } from "~/lib/fp/result"
import { resolveSemanticSql } from "./resolve-semantic"
import { sqlQueriesFilesTable } from "./semantic"
import { probe } from "./probe"
import { capStage } from "./cap"
import { mergeStage } from "./merge"
import { verdict, FILTER_BATCH_SIZE } from "./verdict"
import { trim } from "./trim"
import { extendRegionsForAnnotations } from "./extend-annotations"
import { isDebugOn } from "~/lib/debug/options"

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

const applyCap = (hits: SearchHit[], files: FileStore): SearchHit[] => capStage(hits, files)

const applyMerge = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  isDebugOn("skipMerge") ? hits : mergeStage(hits, files)

const applyTrim = (hits: SearchHit[]): SearchHit[] => (isDebugOn("skipTrim") ? hits : trim(hits))

const applyExtend = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  isDebugOn("skipAnnotationExtend") ? hits : extendRegionsForAnnotations(hits, files)

const tail = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  applyExtend(applyTrim(hits), files)

export const extractSignalTexts = (hydes: HydeQuery[]): string[] =>
  hydes.filter((h) => h.type === "signal").map((h) => h.text)

const runVerdictWithTail = async (
  hits: SearchHit[],
  intent: string,
  signals: string[],
  files: FileStore,
  target: number,
  onResults?: (batch: SearchHit[]) => void
) => {
  const collected: SearchHit[] = []
  const onBatch = (batch: SearchHit[]) => {
    const out = tail(batch, files)
    collected.push(...out)
    onResults?.(out)
  }

  const { consumed, barren } = await verdict(hits, intent, signals, onBatch, {
    target,
    maxBarren: isDebugOn("skipBarrenCheck") ? undefined : MAX_BARREN_BATCHES,
  })

  const rawConsumed = Math.min(consumed * FILTER_BATCH_SIZE, hits.length)
  const rawRemaining = hits.slice(rawConsumed)
  const exhausted = rawRemaining.length === 0 || barren

  return { hits: sortByScore(collected), rawRemaining, exhausted }
}

interface BuildResultArgs {
  probeOutput: {
    rawHits: SearchHit[]
    hydes: HydeQuery[]
    isSemantic: boolean
    embeddings?: EmbeddingsCache
    highlight?: string
  }
  sql: string
  highlight: string
  files: FileStore
  target: number
  onResults?: (batch: SearchHit[]) => void
}

const buildResult = async ({
  probeOutput,
  sql,
  highlight,
  files,
  target,
  onResults,
}: BuildResultArgs): Promise<Result<PipelineResult, PipelineError>> => {
  const { rawHits: rawProbeHits, hydes, isSemantic, embeddings } = probeOutput
  const resolvedHighlight = probeOutput.highlight

  const grouped = applyMerge(applyCap(rawProbeHits, files), files)

  if (grouped.length === 0) {
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
  }

  const skipFilter = isDebugOn("skipFilter")
  const needsFiltering = !skipFilter && sqlQueriesFilesTable(sql)

  if (!needsFiltering) {
    const hits = tail(grouped, files)
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
  if (!effectiveHighlight) {
    return err({
      message: "Semantic filtering requires a highlight but none was resolved or provided",
    })
  }

  const filtered = await runVerdictWithTail(
    grouped,
    effectiveHighlight,
    extractSignalTexts(hydes),
    files,
    target,
    onResults
  )

  return ok({
    ...filtered,
    hydes,
    isSemantic,
    embeddings,
    highlight: resolvedHighlight,
    needsFiltering: true,
  })
}

export const runSearchPipeline = async (
  sql: string,
  highlight: string,
  ctx: SemanticContext,
  files: FileStore,
  target: number,
  onResults?: (batch: SearchHit[]) => void
): Promise<Result<PipelineResult, PipelineError>> => {
  const resolved = await resolveSemanticSql(sql, ctx)
  if (!resolved.ok) return err({ message: resolved.error.message })
  const probed = await probe(resolved.value, ctx.db)
  if (!probed.ok) return err(probed.error)
  return buildResult({ probeOutput: probed.value, sql, highlight, files, target, onResults })
}

export const executeResolvedSearch = async (
  resolved: ResolvedQuery,
  sql: string,
  highlight: string,
  db: Database,
  files: FileStore,
  target: number,
  onResults?: (batch: SearchHit[]) => void
): Promise<Result<PipelineResult, PipelineError>> => {
  const probed = await probe(resolved, db)
  if (!probed.ok) return err(probed.error)
  return buildResult({ probeOutput: probed.value, sql, highlight, files, target, onResults })
}

export const runVerdictTail = runVerdictWithTail
