// Search pipeline — linear chain.
//
//   probe                → SearchHit[]   (Stage 1)                            raw chunk hits from vector + bm25
//   capStage             → SearchHit[]   (Stage 2)  [skipCap]                 cap per file (limiting, not merging)
//   mergeStage           → SearchHit[]   (Stage 3)  [skipMerge]               seed-and-grow (score-ratio gate) + reslice from source
//   verdict              → SearchHit[]   (Stage 4)  [skipFilter]              per-batch: scout[skipScoutFilter] → semantic-filter
//   trim                 → SearchHit[]   (Stage 5)  [skipTrim]                trim within hit.text using matchRanges
//   extendForAnnotations → SearchHit[]   (Stage 6)  [skipAnnotationExtend]    grow byte range to swallow overlapping annotations + append `json-annotations` block to text
//
// Each stage lives in its own file. Toggles short-circuit a stage to a pass-through.
// verdict is the only async/batched/streaming step; per-batch tail (trim → extend) fires via onResults.
// Scout is per-batch inside verdict — framework-aware coarse filter against the current batch's files.

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
import { yieldToBrowser } from "~/lib/utils/async"

const computeMaxBarren = (target: number): number => Math.ceil(target / FILTER_BATCH_SIZE)

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

const applyCap = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  isDebugOn("skipCap") ? hits : capStage(hits, files)

const applyMerge = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  isDebugOn("skipMerge") ? hits : mergeStage(hits, files)

const logFinalHits = (hits: SearchHit[]): void => {
  console.debug(
    "[search] final pipeline output:",
    hits.map((h) => ({
      file: h.file,
      hash: h.hash,
      constituentHashes: h.constituentHashes,
      text: h.text,
    }))
  )
}

const applyTrim = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  isDebugOn("skipTrim") ? hits : trim(hits, files)

const applyExtend = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  isDebugOn("skipAnnotationExtend") ? hits : extendRegionsForAnnotations(hits, files)

const tail = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  applyExtend(applyTrim(hits, files), files)

const runVerdictWithTail = async (
  hits: SearchHit[],
  intent: string,
  framework: string,
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

  const { consumed, barren } = await verdict(hits, intent, framework, files, onBatch, {
    target,
    maxBarren: isDebugOn("skipBarrenCheck") ? undefined : computeMaxBarren(target),
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
  framework: string
  target: number
  onResults?: (batch: SearchHit[]) => void
}

const buildResult = async ({
  probeOutput,
  sql,
  highlight,
  files,
  framework,
  target,
  onResults,
}: BuildResultArgs): Promise<Result<PipelineResult, PipelineError>> => {
  const { rawHits: rawProbeHits, hydes, isSemantic, embeddings } = probeOutput
  const resolvedHighlight = probeOutput.highlight

  await yieldToBrowser()
  const capped = applyCap(rawProbeHits, files)
  await yieldToBrowser()
  const grouped = applyMerge(capped, files)
  await yieldToBrowser()

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
    logFinalHits(hits)
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
    framework,
    files,
    target,
    onResults
  )

  logFinalHits(filtered.hits)

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
  framework = "",
  onResults?: (batch: SearchHit[]) => void
): Promise<Result<PipelineResult, PipelineError>> => {
  const resolved = await resolveSemanticSql(sql, ctx)
  if (!resolved.ok) return err({ message: resolved.error.message })
  const probed = await probe(resolved.value, ctx.db, files)
  if (!probed.ok) return err(probed.error)
  return buildResult({
    probeOutput: probed.value,
    sql,
    highlight,
    files,
    framework,
    target,
    onResults,
  })
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
  const probed = await probe(resolved, db, files)
  if (!probed.ok) return err(probed.error)
  return buildResult({
    probeOutput: probed.value,
    sql,
    highlight,
    files,
    framework: "",
    target,
    onResults,
  })
}

export const runVerdictTail = (
  hits: SearchHit[],
  intent: string,
  files: FileStore,
  target: number,
  onResults?: (batch: SearchHit[]) => void
) => runVerdictWithTail(hits, intent, "", files, target, onResults)
