import { z } from "zod"
import type { SearchHit } from "~/domain/search/types"
import type { PoolResult } from "~/lib/utils/pool"
import type { FileStore } from "~/lib/files/store"
import { toSystem } from "~/lib/agent/client/convert"
import { callAndParse } from "~/lib/agent/client/call-parse"
import { buildKey, tryGet, tryPut } from "~/lib/utils/storage-cache"
import { splitSentences } from "~/lib/text/split"
import { formatNumberedPassage } from "~/lib/text/format"
import { toLetter, parseRef } from "~/lib/text/prefix-ref"
import { dedupOverlapping, type Spanned } from "~/lib/text/spans"
import { processPool } from "~/lib/utils/pool"
import { isDebugOn } from "~/lib/debug/options"
import { scoutFilterBatch } from "./scout"

export const FILTER_BATCH_SIZE = 10
export const FILTER_CONCURRENCY = 5

const SEMANTIC_FILTER_ENDPOINT = "/semantic-filter"
const REF_SEPARATOR = "-"
const MIN_WORD_COUNT = 3
const WORD_SPLIT_RE = /\s+/

const FILTER_CALL_TO_ACTION =
  'Return { results: [{ start, end, reasonToKeep }, ...] } where start and end are prefixed sentence refs like "a-3" and reasonToKeep names the clause or signal the passage satisfies.'

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

const ConfidenceSchema = z.enum(["clear", "borderline"])
export type FilterConfidence = z.infer<typeof ConfidenceSchema>

const FilterMatchSchema = z.object({
  start: z.string(),
  end: z.string(),
  confidence: ConfidenceSchema,
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
  confidence: FilterConfidence
  reasonToKeep: string
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
  return {
    prefix: startRef.prefix,
    start: startRef.n,
    end: endRef.n,
    confidence: raw.confidence,
    reasonToKeep: raw.reasonToKeep,
  }
}

const parseMatches = (
  matches: z.infer<typeof FilterResponseSchema>["results"],
  validPrefixes: Set<string>
): ParsedMatch[] => matches.flatMap((m) => parseMatch(m, validPrefixes) ?? [])

const formatHitTarget = (numbered: string, prefix: string): string =>
  `<target prefix="${prefix}">\n${numbered}\n</target>`

const callSemanticFilterBatch = async (
  intent: string,
  prepared: PreparedHit[]
): Promise<ParsedMatch[]> => {
  const messages = [
    toSystem(`<search_intent>${intent}</search_intent>`),
    ...prepared.map((p) => toSystem(formatHitTarget(p.numbered, p.prefix))),
    toSystem(FILTER_CALL_TO_ACTION),
  ]

  const result = await callAndParse(SEMANTIC_FILTER_ENDPOINT, messages, FilterResponseSchema)
  if (!result.ok) return []

  const validPrefixes = new Set(prepared.map((p) => p.prefix))
  return parseMatches(result.data.results, validPrefixes)
}

const FILTER_CACHE_PREFIX = "filter-v4"
const FILTER_CACHE_CAP = 200_000

const hitCacheKey = (intent: string, numbered: string): string => buildKey([intent, numbered])

export interface FilteredSpan extends Spanned {
  confidence: FilterConfidence
  reasonToKeep: string
}

interface CachedHitResult {
  spans: FilteredSpan[]
}

const lookupHitCache = async (
  intent: string,
  prepared: PreparedHit[]
): Promise<(CachedHitResult | undefined)[]> =>
  Promise.all(
    prepared.map((p) =>
      tryGet<CachedHitResult>(FILTER_CACHE_PREFIX, hitCacheKey(intent, p.numbered))
    )
  )

const cacheHitResults = async (
  intent: string,
  prepared: PreparedHit[],
  results: FilteredSpan[][]
): Promise<void> => {
  await Promise.all(
    prepared.map((p, i) =>
      tryPut(
        FILTER_CACHE_PREFIX,
        hitCacheKey(intent, p.numbered),
        { spans: results[i] },
        FILTER_CACHE_CAP
      )
    )
  )
}

const toFilteredSpan = (m: ParsedMatch): FilteredSpan => ({
  start: m.start,
  end: m.end,
  confidence: m.confidence,
  reasonToKeep: m.reasonToKeep,
})

const splitMatchesByPrefix = (matches: ParsedMatch[], prepared: PreparedHit[]): FilteredSpan[][] =>
  prepared.map((p) =>
    dedupOverlapping(matches.filter((m) => m.prefix === p.prefix).map(toFilteredSpan))
  )

const runFilter = async (intent: string, prepared: PreparedHit[]): Promise<FilteredSpan[][]> => {
  const cached = await lookupHitCache(intent, prepared)

  const uncached = prepared.filter((_, i) => cached[i] === undefined)

  if (uncached.length === 0) return cached.map((c) => c?.spans ?? [])

  const matches = await callSemanticFilterBatch(intent, uncached)
  const freshSpans = splitMatchesByPrefix(matches, uncached)
  await cacheHitResults(intent, uncached, freshSpans)

  let freshIdx = 0
  return cached.map((v) => (v ? v.spans : freshSpans[freshIdx++]))
}

const spanToRange = (
  s: FilteredSpan
): {
  start: number
  end: number
  confidence: FilterConfidence
  reasonToKeep: string
} => ({
  start: s.start - 1,
  end: s.end - 1,
  confidence: s.confidence,
  reasonToKeep: s.reasonToKeep,
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

const reconstructBatchHits = (prepared: PreparedHit[], results: FilteredSpan[][]): SearchHit[] =>
  prepared.flatMap((p, i) => {
    const spans = results[i]
    if (!spans || spans.length === 0) return []
    const matches = extractMatchTexts(p.sentences, spans)
    if (matches.length === 0) return []
    const matchRanges = spans.map(spanToRange)
    return [{ ...p.hit, matches, matchRanges }]
  })

const applyScout = async (
  hits: SearchHit[],
  framework: string,
  files: FileStore
): Promise<SearchHit[]> =>
  isDebugOn("skipScoutFilter") ? hits : await scoutFilterBatch(hits, framework, files)

const verdictBatch = async (
  hits: SearchHit[],
  intent: string,
  framework: string,
  files: FileStore
): Promise<SearchHit[]> => {
  const scouted = await applyScout(hits, framework, files)
  const prepared = scouted
    .map((h, i) => prepareHit(h, i))
    .filter((p): p is PreparedHit => p !== null)
  if (prepared.length === 0) return scouted.filter((h) => !h.text)

  try {
    const results = await runFilter(intent, prepared)
    const passThrough = scouted.filter((h) => !h.text)
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
  framework: string,
  files: FileStore,
  onBatch: (batch: SearchHit[]) => void,
  opts?: VerdictOptions
): Promise<PoolResult<SearchHit[], SearchHit>> =>
  processPool(chunkHits(hits), (chunk) => verdictBatch(chunk, intent, framework, files), onBatch, {
    concurrency: FILTER_CONCURRENCY,
    target: opts?.target,
    maxBarren: opts?.maxBarren,
  })
