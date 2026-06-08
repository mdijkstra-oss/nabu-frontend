import { z } from "zod"
import type { SearchHit } from "~/domain/search/types"
import type { PoolResult } from "~/lib/utils/pool"
import { toSystem } from "~/lib/agent/client/convert"
import { callAndParse } from "~/lib/agent/client/call-parse"
import { buildKey, tryGet, tryPut } from "~/lib/utils/storage-cache"
import { splitSentences } from "~/lib/text/split"
import { formatNumberedPassage } from "~/lib/text/format"
import { toLetter, parseRef } from "~/lib/text/prefix-ref"
import { collapseRunsByOverlap, dedupOverlapping, type Spanned } from "~/lib/text/spans"
import { processPool } from "~/lib/utils/pool"
import { isDebugOn } from "~/lib/debug/options"

export const FILTER_BATCH_SIZE = 5
export const FILTER_CONCURRENCY = 5
export const FILTER_RUNS = 2

const SEMANTIC_FILTER_ENDPOINT = "/semantic-filter"
const REF_SEPARATOR = "-"
const AGREEMENT_THRESHOLD = 0.8
const MIN_WORD_COUNT = 3
const WORD_SPLIT_RE = /\s+/

const FILTER_CALL_TO_ACTION =
  'Return { results: [{ start, end, reasonToKeep }, ...] } where start and end are prefixed sentence refs like "a-3" and reasonToKeep names the clause or signal the passage satisfies.'

const MAX_SELECTED_RATIO = 0.4

const hasEnoughWords = (text: string): boolean => text.split(WORD_SPLIT_RE).length >= MIN_WORD_COUNT

interface PreparedHit {
  hit: SearchHit
  sentences: string[]
  numbered: string
  prefix: string
}

const prepareHit = (hit: SearchHit, index: number): PreparedHit | null => {
  if (!hit.text) return null
  const sentences = splitSentences(hit.text)
  if (sentences.length === 0) return null
  const prefix = toLetter(index)
  const numbered = formatNumberedPassage(hit.text, { prefix, separator: REF_SEPARATOR })
  return { hit, sentences, numbered, prefix }
}

const FilterMatchSchema = z.object({
  start: z.string(),
  end: z.string(),
  reasonToKeep: z.string(),
})

// Wrapper object — some providers reject a top-level JSON array as structured output.
const FilterResponseSchema = z.object({
  results: z.array(FilterMatchSchema),
})

interface ParsedMatch {
  prefix: string
  start: number
  end: number
}

const parseMatch = (
  raw: z.infer<typeof FilterMatchSchema>,
  validPrefixes: Set<string>
): ParsedMatch | null => {
  const startRef = parseRef(raw.start, REF_SEPARATOR)
  const endRef = parseRef(raw.end, REF_SEPARATOR)
  if (!startRef || !endRef) return null
  if (startRef.prefix !== endRef.prefix) return null
  if (!validPrefixes.has(startRef.prefix)) return null
  if (endRef.n < startRef.n) return null
  return { prefix: startRef.prefix, start: startRef.n, end: endRef.n }
}

const parseMatches = (
  matches: z.infer<typeof FilterResponseSchema>["results"],
  validPrefixes: Set<string>
): ParsedMatch[] => matches.flatMap((m) => parseMatch(m, validPrefixes) ?? [])

const groupRunsByPrefix = (runs: ParsedMatch[][], prefixes: string[]): Map<string, Spanned[][]> => {
  const byPrefix = new Map<string, Spanned[][]>(
    prefixes.map((p) => [p, Array.from({ length: runs.length }, (): Spanned[] => [])])
  )
  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    for (const match of runs[runIdx]) {
      const perRun = byPrefix.get(match.prefix)
      if (!perRun) continue
      perRun[runIdx].push({ start: match.start, end: match.end })
    }
  }
  return byPrefix
}

const collapseSpansPerPrefix = (
  runs: ParsedMatch[][],
  prefixes: string[]
): Map<string, Spanned[]> => {
  const perPrefixRuns = groupRunsByPrefix(runs, prefixes)
  const out = new Map<string, Spanned[]>()
  for (const [prefix, perRun] of perPrefixRuns) {
    const collapsed = collapseRunsByOverlap(perRun, AGREEMENT_THRESHOLD).map((v) => v.span)
    out.set(prefix, dedupOverlapping(collapsed))
  }
  return out
}

const formatHitTarget = (numbered: string, prefix: string): string =>
  `<target prefix="${prefix}">\n${numbered}\n</target>`

const formatSignalExamples = (signals: string[]): string =>
  `<signal_examples>\n${signals.map((s) => `- ${s}`).join("\n")}\n</signal_examples>`

const callSemanticFilterBatch = async (
  intent: string,
  signals: string[],
  prepared: PreparedHit[],
  runIdx: number
): Promise<ParsedMatch[]> => {
  const messages = [
    toSystem(`<search_intent>${intent}</search_intent>`),
    ...(signals.length > 0 ? [toSystem(formatSignalExamples(signals))] : []),
    ...prepared.map((p) => toSystem(formatHitTarget(p.numbered, p.prefix))),
    toSystem(FILTER_CALL_TO_ACTION),
  ]

  const endpoint = `${SEMANTIC_FILTER_ENDPOINT}?model=${runIdx}`
  const result = await callAndParse(endpoint, messages, FilterResponseSchema)
  if (!result.ok) return []

  const validPrefixes = new Set(prepared.map((p) => p.prefix))
  return parseMatches(result.data.results, validPrefixes)
}

const FILTER_CACHE_PREFIX = "filter-v2"
const FILTER_CACHE_CAP = 200_000

const signalsKeyPart = (signals: string[]): string => buildKey([...signals].sort())

const hitCacheKey = (
  runIdx: number,
  intent: string,
  signalsKey: string,
  numbered: string
): string => buildKey([String(runIdx), intent, signalsKey, numbered])

interface CachedHitResult {
  spans: Spanned[]
}

const lookupHitCache = async (
  runIdx: number,
  intent: string,
  signalsKey: string,
  prepared: PreparedHit[]
): Promise<(CachedHitResult | undefined)[]> =>
  Promise.all(
    prepared.map((p) =>
      tryGet<CachedHitResult>(
        FILTER_CACHE_PREFIX,
        hitCacheKey(runIdx, intent, signalsKey, p.numbered)
      )
    )
  )

const cacheHitResults = async (
  runIdx: number,
  intent: string,
  signalsKey: string,
  prepared: PreparedHit[],
  results: Spanned[][]
): Promise<void> => {
  await Promise.all(
    prepared.map((p, i) =>
      tryPut(
        FILTER_CACHE_PREFIX,
        hitCacheKey(runIdx, intent, signalsKey, p.numbered),
        { spans: results[i] },
        FILTER_CACHE_CAP
      )
    )
  )
}

const splitMatchesByPrefix = (matches: ParsedMatch[], prepared: PreparedHit[]): Spanned[][] =>
  prepared.map((p) =>
    matches.filter((m) => m.prefix === p.prefix).map((m) => ({ start: m.start, end: m.end }))
  )

const cachedCallSemanticFilterBatch = async (
  intent: string,
  signals: string[],
  prepared: PreparedHit[],
  runIdx: number
): Promise<Spanned[][]> => {
  const signalsKey = signalsKeyPart(signals)
  const cached = await lookupHitCache(runIdx, intent, signalsKey, prepared)

  const uncached = prepared.filter((_, i) => cached[i] === undefined)

  if (uncached.length === 0) return cached.map((c) => c?.spans ?? [])

  const matches = await callSemanticFilterBatch(intent, signals, uncached, runIdx)
  const freshSpans = splitMatchesByPrefix(matches, uncached)
  await cacheHitResults(runIdx, intent, signalsKey, uncached, freshSpans)

  let freshIdx = 0
  return cached.map((v) => (v ? v.spans : freshSpans[freshIdx++]))
}

const CHEAP_FILTER_MODEL_INDEX = 2

const collectRunsPerHit = (
  perRunSpans: Spanned[][][],
  prepared: PreparedHit[]
): ParsedMatch[][] => {
  return perRunSpans.map((spansPerHit) =>
    prepared.flatMap((p, hitIdx) =>
      spansPerHit[hitIdx].map((s) => ({ prefix: p.prefix, start: s.start, end: s.end }))
    )
  )
}

const isOverselected = (spans: Spanned[], totalSentences: number): boolean => {
  const selected = new Set<number>()
  for (const s of spans) {
    for (let i = s.start; i <= s.end; i++) selected.add(i)
  }
  return selected.size > totalSentences * MAX_SELECTED_RATIO
}

const runAllModels = async (
  intent: string,
  signals: string[],
  prepared: PreparedHit[]
): Promise<Spanned[][]> => {
  const runIndices = isDebugOn("cheapFilter")
    ? [CHEAP_FILTER_MODEL_INDEX]
    : Array.from({ length: FILTER_RUNS }, (_, i) => i)
  const perRunSpans = await Promise.all(
    runIndices.map((runIdx) => cachedCallSemanticFilterBatch(intent, signals, prepared, runIdx))
  )
  const perRunMatches = collectRunsPerHit(perRunSpans, prepared)
  const collapsedByPrefix = collapseSpansPerPrefix(
    perRunMatches,
    prepared.map((p) => p.prefix)
  )

  return prepared.map((p) => {
    const spans = collapsedByPrefix.get(p.prefix) ?? []
    return isOverselected(spans, p.sentences.length) ? [] : spans
  })
}

const spanToRange = (s: Spanned): { start: number; end: number } => ({
  start: s.start - 1,
  end: s.end - 1,
})

export const extractMatchTexts = (sentences: string[], spans: Spanned[]): string[] =>
  spans
    .map((s) => {
      const lo = Math.max(1, s.start)
      const hi = Math.min(sentences.length, s.end)
      if (hi < lo) return ""
      const parts: string[] = []
      for (let i = lo; i <= hi; i++) parts.push(sentences[i - 1])
      return parts.join(" ").trim()
    })
    .filter(hasEnoughWords)

const reconstructBatchHits = (prepared: PreparedHit[], results: Spanned[][]): SearchHit[] =>
  prepared.flatMap((p, i) => {
    const spans = results[i]
    if (!spans || spans.length === 0) return []
    const matches = extractMatchTexts(p.sentences, spans)
    if (matches.length === 0) return []
    const matchRanges = spans.map(spanToRange)
    return [{ ...p.hit, matches, matchRanges }]
  })

const verdictBatch = async (
  hits: SearchHit[],
  intent: string,
  signals: string[]
): Promise<SearchHit[]> => {
  const prepared = hits.map((h, i) => prepareHit(h, i)).filter((p): p is PreparedHit => p !== null)
  if (prepared.length === 0) return hits.filter((h) => !h.text)

  try {
    const results = await runAllModels(intent, signals, prepared)
    const passThrough = hits.filter((h) => !h.text)
    return [...passThrough, ...reconstructBatchHits(prepared, results)]
  } catch (e) {
    console.error("[verdict] batch failed", e)
    return []
  }
}

const chunkHits = (hits: SearchHit[]): SearchHit[][] => {
  const chunks: SearchHit[][] = []
  for (let i = 0; i < hits.length; i += FILTER_BATCH_SIZE) {
    chunks.push(hits.slice(i, i + FILTER_BATCH_SIZE))
  }
  return chunks
}

export interface VerdictOptions {
  target?: number
  maxBarren?: number
}

export const verdict = (
  hits: SearchHit[],
  intent: string,
  signals: string[],
  onBatch: (batch: SearchHit[]) => void,
  opts?: VerdictOptions
): Promise<PoolResult<SearchHit[], SearchHit>> =>
  processPool(chunkHits(hits), (chunk) => verdictBatch(chunk, intent, signals), onBatch, {
    concurrency: FILTER_CONCURRENCY,
    target: opts?.target,
    maxBarren: opts?.maxBarren,
  })
