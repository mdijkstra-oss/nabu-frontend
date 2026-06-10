import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { think, REVISITING, FILTERING, ADJUDICATING } from "./thoughts"
import { groupByCode } from "./step-batch"
import { filterAnnotations, type FilterStats } from "./step-filter"
import { adjudicateAnnotations, type AdjudStats } from "./step-adjudicate"
import { POST_FIND_CONCURRENCY } from "./def"

export interface PipelineResult {
  annotations: Annotation[]
  errors: string[]
}

interface BatchResult {
  annotations: Annotation[]
  errors: string[]
  stats: FilterStats
}

const mergeFilterStats = (fragments: readonly FilterStats[]): FilterStats => {
  const merged: FilterStats = new Map()
  for (const frag of fragments) {
    for (const [code, [m0, m1]] of frag) {
      const entry = merged.get(code) ?? [0, 0]
      entry[0] += m0
      entry[1] += m1
      merged.set(code, entry)
    }
  }
  return merged
}

const collectCodes = (filter: FilterStats, adjud: AdjudStats): string[] => {
  const codes = new Set<string>()
  for (const c of filter.keys()) codes.add(c)
  for (const c of adjud.keys()) codes.add(c)
  return [...codes].sort()
}

const formatPair = (stats: Map<string, [number, number]>, code: string): string => {
  const [m0, m1] = stats.get(code) ?? [0, 0]
  return `m0:${m0} m1:${m1}`
}

const formatAdjud = (stats: AdjudStats, code: string): string => {
  const e = stats.get(code) ?? { kept: 0, rejected: 0, ambig: 0 }
  return `k:${e.kept} r:${e.rejected} a:${e.ambig}`
}

const padRight = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length))

const LEGEND = [
  "per-code pipeline counts:",
  "  filter       spans each filter model voted 'keep' (m0/m1)",
  "  adjud(k/r/a) contested spans resolved as kept / rejected / still-ambig",
].join("\n")

const formatStatsTable = (scope: string, filter: FilterStats, adjud: AdjudStats): string => {
  const codes = collectCodes(filter, adjud)
  if (codes.length === 0) return `[deep-analysis] ${scope}: no annotations`

  const rows = codes.map((code) => [code, formatPair(filter, code), formatAdjud(adjud, code)])
  const header = ["code", "filter", "adjud(k/r/a)"]
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const renderRow = (r: readonly string[]): string =>
    r.map((cell, i) => padRight(cell, widths[i])).join("  ")
  return [
    `[deep-analysis] ${scope}`,
    LEGEND,
    "",
    renderRow(header),
    renderRow(widths.map((w) => "-".repeat(w))),
    ...rows.map(renderRow),
  ].join("\n")
}

const processBatch = async (
  annotations: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  resolve: ContentResolver
): Promise<BatchResult> => {
  think(FILTERING)
  const filterResult = await filterAnnotations(annotations, sentences, sources, resolve)
  return {
    annotations: filterResult.surviving,
    errors: filterResult.errors,
    stats: filterResult.stats,
  }
}

export const runAnalysisPipeline = async (
  incoming: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  resolve: ContentResolver,
  firstFile: string
): Promise<PipelineResult> => {
  if (incoming.length === 0) {
    console.debug(formatStatsTable(firstFile, new Map(), new Map()))
    return { annotations: [], errors: [] }
  }

  const batches = groupByCode(incoming)

  think(REVISITING)
  const { results: batchResults, failures } = await processPool(
    batches,
    async (batch) => [await processBatch(batch, sentences, sources, resolve)],
    noop,
    { concurrency: POST_FIND_CONCURRENCY }
  )

  const surviving: Annotation[] = []
  const allErrors: string[] = []
  for (const br of batchResults) {
    surviving.push(...br.annotations)
    allErrors.push(...br.errors)
  }
  for (const f of failures) allErrors.push(errorMessage(f.error))

  const filterStats = mergeFilterStats(batchResults.map((br) => br.stats))

  think(ADJUDICATING)
  const adjudicated = await adjudicateAnnotations(surviving, sentences, sources, resolve)
  allErrors.push(...adjudicated.errors)

  console.debug(formatStatsTable(firstFile, filterStats, adjudicated.stats))

  return { annotations: adjudicated.annotations, errors: allErrors }
}
