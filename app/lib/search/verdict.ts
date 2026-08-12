import { z } from "zod"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { PoolResult } from "~/lib/utils/pool"
import { callAndParse } from "~/lib/agent/client/call-parse"
import { toSystem } from "~/lib/agent/client/convert"
import {
  assignIds,
  buildEntryMessages,
  entrySize,
  refString,
  resolveRef,
  type Entry,
  type EntryInput,
} from "~/lib/calls/entry"
import { pack } from "~/lib/calls/pack"
import { buildKey, tryGet, tryPut } from "~/lib/utils/storage-cache"
import { splitSentences } from "~/lib/text/split"
import { dedupOverlapping, type Spanned } from "~/lib/text/spans"
import { processPool } from "~/lib/utils/pool"
import { isDebugOn } from "~/lib/debug/options"
import { UNIT_CEILING_CHARS } from "~/lib/cutting/constants"
import { scoutFilterBatch } from "./scout"

export const FILTER_ITEM_CAP = 10

export const FILTER_CACHE_PREFIX = "filter-v5"

export interface FilteredSpan extends Spanned {
  confidence: FilterConfidence
  reasonToKeep: string
}

export interface CachedSpans {
  spans: FilteredSpan[]
}

export interface FilterCache {
  get: (key: string) => Promise<CachedSpans | undefined>
  put: (key: string, value: CachedSpans) => Promise<void>
}

export interface VerdictOptions {
  target?: number
  maxBarren?: number
}

export interface VerdictDeps {
  parse: typeof callAndParse
  cache: FilterCache
}

export type VerdictResult = PoolResult<SearchHit[], SearchHit> & {
  rawRemaining: SearchHit[]
}

export const verdict = async (
  hits: SearchHit[],
  intent: string,
  framework: string,
  files: FileStore,
  onBatch: (batch: SearchHit[]) => void,
  opts?: VerdictOptions,
  deps: Partial<VerdictDeps> = {}
): Promise<VerdictResult> => {
  const { parse = callAndParse, cache = storageCache } = deps
  const batches = pack(hits, {
    sizeOf: hitSize,
    maxChars: FILTER_MAX_CHARS,
    maxItems: FILTER_ITEM_CAP,
  })
  const answered = new Set<SearchHit[]>()
  const pool = await processPool(
    batches,
    async (batch) => {
      const results = await verdictBatch(batch, intent, framework, files, { parse, cache })
      answered.add(batch)
      return results
    },
    onBatch,
    { concurrency: FILTER_CONCURRENCY, target: opts?.target, maxBarren: opts?.maxBarren }
  )
  return { ...pool, rawRemaining: unansweredHits(hits, batches, answered) }
}

const FILTER_MAX_CHARS = FILTER_ITEM_CAP * UNIT_CEILING_CHARS
const FILTER_CONCURRENCY = 5

const SEMANTIC_FILTER_ENDPOINT = "/semantic-filter"

const FILTER_CALL_TO_ACTION =
  'Return { results: [{ start, end, confidence, reasonToKeep }, ...] } where start and end are sentence refs like "1.2" — the entry id, a dot, then the sentence number within that entry — and reasonToKeep names the clause or signal the passage satisfies.'

const ConfidenceSchema = z.enum(["clear", "borderline"])
export type FilterConfidence = z.infer<typeof ConfidenceSchema>

const FilterMatchSchema = z.object({
  start: refString(),
  end: refString(),
  confidence: ConfidenceSchema,
  reasonToKeep: z.string(),
})

// Wrapper object — some providers reject a top-level JSON array as structured output.
export const FilterResponseSchema = z.object({
  results: z.array(FilterMatchSchema),
})

const FILTER_CACHE_CAP = 200_000

const storageCache: FilterCache = {
  get: (key) => tryGet(FILTER_CACHE_PREFIX, key),
  put: (key, value) => tryPut(FILTER_CACHE_PREFIX, key, value, FILTER_CACHE_CAP),
}

const cacheKey = (intent: string, hit: SearchHit): string => buildKey([intent, hit.text ?? ""])

interface FilterEntryInput extends EntryInput<SearchHit> {
  content: { numbered: string[] }
}

const toFilterEntry = (hit: SearchHit): FilterEntryInput => ({
  item: hit,
  file: hit.file,
  content: { numbered: splitSentences(hit.text ?? "") },
})

const filterEntriesOf = (hits: SearchHit[]): FilterEntryInput[] =>
  hits
    .filter((hit) => hit.text)
    .map(toFilterEntry)
    .filter((entry) => entry.content.numbered.length > 0)

const hitSize = (hit: SearchHit): number => (hit.text ? entrySize(toFilterEntry(hit)) : 0)

interface ResolvedMatch {
  entry: Entry<SearchHit>
  span: FilteredSpan
}

const resolveMatch = (
  raw: z.infer<typeof FilterMatchSchema>,
  entries: readonly Entry<SearchHit>[]
): ResolvedMatch | null => {
  const start = resolveRef(raw.start, entries)
  const end = resolveRef(raw.end, entries)
  if (!start || !end || start.entry !== end.entry) return null
  if (end.sentenceIndex < start.sentenceIndex) return null
  return {
    entry: start.entry,
    span: {
      start: start.sentenceIndex + 1,
      end: end.sentenceIndex + 1,
      confidence: raw.confidence,
      reasonToKeep: raw.reasonToKeep,
    },
  }
}

const callFilter = async (
  intent: string,
  inputs: FilterEntryInput[],
  parse: typeof callAndParse
): Promise<Map<SearchHit, FilteredSpan[]>> => {
  const entries = assignIds(inputs)
  const shape = {
    stable: [toSystem(`<search_intent>${intent}</search_intent>`)],
    callToAction: FILTER_CALL_TO_ACTION,
  }
  const result = await parse(
    SEMANTIC_FILTER_ENDPOINT,
    buildEntryMessages(shape, entries),
    FilterResponseSchema
  )
  if (!result.ok) throw new Error(`semantic-filter failed: ${result.error}`)

  const resolved = result.data.results.flatMap((raw) => resolveMatch(raw, entries) ?? [])
  return new Map(
    entries.map((entry) => [
      entry.item,
      dedupOverlapping(resolved.filter((m) => m.entry === entry).map((m) => m.span)),
    ])
  )
}

const spansForBatch = async (
  intent: string,
  inputs: FilterEntryInput[],
  deps: VerdictDeps
): Promise<FilteredSpan[][]> => {
  const cached = await Promise.all(
    inputs.map((input) => deps.cache.get(cacheKey(intent, input.item)))
  )
  const misses = inputs.filter((_, i) => cached[i] === undefined)
  const fresh =
    misses.length > 0
      ? await callFilter(intent, misses, deps.parse)
      : new Map<SearchHit, FilteredSpan[]>()
  await Promise.all(
    misses.map((input) =>
      deps.cache.put(cacheKey(intent, input.item), { spans: fresh.get(input.item) ?? [] })
    )
  )
  return inputs.map((input, i) => cached[i]?.spans ?? fresh.get(input.item) ?? [])
}

const spanToRange = (s: FilteredSpan) => ({
  start: s.start - 1,
  end: s.end - 1,
  confidence: s.confidence,
  reasonToKeep: s.reasonToKeep,
})

const extractMatchTexts = (sentences: string[], spans: Spanned[]): string[] =>
  spans
    .map((s) => {
      const lo = Math.max(1, s.start)
      const hi = Math.min(sentences.length, s.end)
      if (hi < lo) return ""
      const parts: string[] = []
      for (let i = lo; i <= hi; i++) parts.push(sentences[i - 1])
      return parts.join(" ").trim()
    })
    .filter((t) => t.length > 0)

const reconstructBatchHits = (
  inputs: FilterEntryInput[],
  spansPerInput: FilteredSpan[][]
): SearchHit[] =>
  inputs.flatMap((input, i) => {
    const spans = spansPerInput[i]
    if (spans.length === 0) return []
    const matches = extractMatchTexts(input.content.numbered, spans)
    if (matches.length === 0) return []
    return [{ ...input.item, matches, matchRanges: spans.map(spanToRange) }]
  })

const applyScout = async (
  hits: SearchHit[],
  framework: string,
  files: FileStore,
  parse: typeof callAndParse
): Promise<SearchHit[]> =>
  isDebugOn("skipScoutFilter") ? hits : await scoutFilterBatch(hits, framework, files, parse)

const verdictBatch = async (
  batch: SearchHit[],
  intent: string,
  framework: string,
  files: FileStore,
  deps: VerdictDeps
): Promise<SearchHit[]> => {
  const scouted = await applyScout(batch, framework, files, deps.parse)
  const passThrough = scouted.filter((hit) => !hit.text)
  const inputs = filterEntriesOf(scouted)
  if (inputs.length === 0) return passThrough

  const spans = await spansForBatch(intent, inputs, deps)
  return [...passThrough, ...reconstructBatchHits(inputs, spans)]
}

const unansweredHits = (
  hits: SearchHit[],
  batches: SearchHit[][],
  answered: ReadonlySet<SearchHit[]>
): SearchHit[] => {
  const remaining = new Set<SearchHit>()
  for (const batch of batches) {
    if (answered.has(batch)) continue
    for (const hit of batch) remaining.add(hit)
  }
  return hits.filter((hit) => remaining.has(hit))
}
