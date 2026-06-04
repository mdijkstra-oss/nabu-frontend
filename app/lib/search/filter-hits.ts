import { z } from "zod"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { PoolResult } from "~/lib/utils/pool"
import { toSystem } from "~/lib/agent/client/convert"
import { callAndParse } from "~/lib/agent/client/call-parse"
import { buildKey, tryGet, tryPut } from "~/lib/utils/storage-cache"
import { splitBySentences } from "~/lib/text/split"
import { formatNumberedPassage } from "~/lib/text/format"
import { processPool } from "~/lib/utils/pool"
import { growHits } from "./slices"

export { formatNumberedPassage } from "~/lib/text/format"

export const FILTER_BATCH_SIZE = 5
export const FILTER_CONCURRENCY = 5

const SEMANTIC_FILTER_ENDPOINT = "/semantic-filter"
const MIN_WORD_COUNT = 3
const WORD_SPLIT_RE = /\s+/

const hasEnoughWords = (text: string): boolean => text.split(WORD_SPLIT_RE).length >= MIN_WORD_COUNT

const FILTER_CALL_TO_ACTION =
  "Return matching sentence ranges as an array of { id, start, end } where id is the passage letter and start/end are 1-based sentence numbers."

const splitSentenceTexts = splitBySentences()

export const splitSentences = (text: string): string[] =>
  splitSentenceTexts(text).map((s) => s.text)

export const toLetter = (index: number): string => {
  let result = ""
  let n = index
  do {
    result = String.fromCharCode(97 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return result
}

export const extractMatchTexts = (sentences: string[], groups: number[][]): string[] =>
  groups
    .map((indices) =>
      indices
        .filter((i) => i >= 1 && i <= sentences.length)
        .map((i) => sentences[i - 1])
        .join(" ")
        .trim()
    )
    .filter(hasEnoughWords)

interface PreparedHit {
  hit: SearchHit
  sentences: string[]
  numbered: string
}

const prepareHit = (hit: SearchHit): PreparedHit | null => {
  if (!hit.text) return null
  const sentences = splitSentences(hit.text)
  if (sentences.length === 0) return null
  return { hit, sentences, numbered: formatNumberedPassage(hit.text) }
}

const FilterMatchSchema = z.object({
  id: z.string(),
  start: z.number().int().min(1),
  end: z.number().int().min(1),
})

const FilterResponseSchema = z.array(FilterMatchSchema)

const expandRange = (start: number, end: number): number[] => {
  const indices: number[] = []
  for (let i = start; i <= end; i++) indices.push(i)
  return indices
}

const groupMatchesByLabel = (
  matches: z.infer<typeof FilterResponseSchema>,
  labels: string[]
): number[][][] => {
  const groups = new Map<string, number[][]>(labels.map((l) => [l, []]))
  for (const m of matches) {
    const bucket = groups.get(m.id)
    if (bucket) bucket.push(expandRange(m.start, m.end))
  }
  return labels.map((l) => groups.get(l) ?? [])
}

const formatHitTarget = (numbered: string, label: string): string =>
  `<target id="${label}">\n${numbered}\n</target>`

const MAX_SELECTED_RATIO = 0.4

const countSelectedSentences = (groups: number[][]): number => new Set(groups.flat()).size

const isOverselected = (groups: number[][], totalSentences: number): boolean =>
  countSelectedSentences(groups) > totalSentences * MAX_SELECTED_RATIO

const callSemanticFilterBatch = async (
  intent: string,
  prepared: PreparedHit[]
): Promise<number[][][]> => {
  const labels = prepared.map((_, i) => toLetter(i))
  const messages = [
    toSystem(`<search_intent>${intent}</search_intent>`),
    ...prepared.map((p, i) => toSystem(formatHitTarget(p.numbered, labels[i]))),
    toSystem(FILTER_CALL_TO_ACTION),
  ]

  const result = await callAndParse(SEMANTIC_FILTER_ENDPOINT, messages, FilterResponseSchema)
  if (!result.ok) return prepared.map(() => [])

  const grouped = groupMatchesByLabel(result.data, labels)
  return grouped.map((groups, i) =>
    isOverselected(groups, prepared[i].sentences.length) ? [] : groups
  )
}

const FILTER_CACHE_PREFIX = "filter"
const FILTER_CACHE_CAP = 200_000

const hitCacheKey = (intent: string, numbered: string): string => buildKey([intent, numbered])

const lookupHitCache = async (
  intent: string,
  prepared: PreparedHit[]
): Promise<(number[][] | undefined)[]> =>
  Promise.all(
    prepared.map((p) => tryGet<number[][]>(FILTER_CACHE_PREFIX, hitCacheKey(intent, p.numbered)))
  )

const cacheHitResults = async (
  intent: string,
  prepared: PreparedHit[],
  results: number[][][]
): Promise<void> => {
  await Promise.all(
    prepared.map((p, i) =>
      tryPut(FILTER_CACHE_PREFIX, hitCacheKey(intent, p.numbered), results[i], FILTER_CACHE_CAP)
    )
  )
}

const cachedCallSemanticFilterBatch = async (
  intent: string,
  prepared: PreparedHit[]
): Promise<number[][][]> => {
  const cached = await lookupHitCache(intent, prepared)

  const uncached = prepared.filter((_, i) => cached[i] === undefined)

  if (uncached.length === 0) return cached as number[][][]

  const fresh = await callSemanticFilterBatch(intent, uncached)
  await cacheHitResults(intent, uncached, fresh)

  let freshIdx = 0
  return cached.map((v) => v ?? fresh[freshIdx++])
}

const reconstructBatchHits = (prepared: PreparedHit[], results: number[][][]): SearchHit[] =>
  prepared.flatMap((p, i) => {
    const groups = results[i]
    if (!groups || groups.length === 0) return []
    const matches = extractMatchTexts(p.sentences, groups)
    if (matches.length === 0) return []
    return [{ ...p.hit, matches }]
  })

const filterBatch = async (hits: SearchHit[], intent: string): Promise<SearchHit[]> => {
  const prepared = hits.map(prepareHit).filter((p): p is PreparedHit => p !== null)
  if (prepared.length === 0) return hits.filter((h) => !h.text)

  try {
    const results = await cachedCallSemanticFilterBatch(intent, prepared)
    const passThrough = hits.filter((h) => !h.text)
    return [...passThrough, ...reconstructBatchHits(prepared, results)]
  } catch (e) {
    console.error("[FILTER] batch failed", e)
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

const filterAndGrowBatch = async (
  hits: SearchHit[],
  intent: string,
  files: FileStore
): Promise<SearchHit[]> => {
  const filtered = await filterBatch(hits, intent)
  return growHits(filtered, files)
}

export interface FilterOptions {
  target?: number
  maxBarren?: number
}

export const filterParallel = (
  hits: SearchHit[],
  intent: string,
  files: FileStore,
  onResults: (results: SearchHit[]) => void,
  opts?: FilterOptions
): Promise<PoolResult<SearchHit[], SearchHit>> =>
  processPool(chunkHits(hits), (chunk) => filterAndGrowBatch(chunk, intent, files), onResults, {
    concurrency: FILTER_CONCURRENCY,
    target: opts?.target,
    maxBarren: opts?.maxBarren,
  })
