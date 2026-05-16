import { z } from "zod"
import { callLlm } from "../../client/fetch"
import { extractText, toResponseFormat } from "../../client/convert"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import {
  type ScopedSources,
  type ContentResolver,
  buildFindCall,
  buildFindResultSchema,
  buildFilterSchema,
  buildAdjudicateSchema,
  buildSpanStepMessages,
  extractSourceIds,
  buildSourceTitleMap,
  REASON_CTA,
  FILTER_CTA,
  ADJUDICATE_CTA,
} from "./messages"
import {
  tallyVotes,
  countKeys,
  filterByTally,
  groupBySpan,
  buildFindVoteMap,
  type FindResult,
  type CodedSpan,
} from "./consensus"
import { spanKey } from "./format"
import { formatCodedSection, type CodedItem } from "./present"
import {
  FIND_ENDPOINT,
  REASON_ENDPOINT,
  FILTER_ENDPOINT,
  ADJUDICATE_ENDPOINT,
  FIND_RUNS,
  FIND_THRESHOLD,
  FIND_MAX_GAP,
  FILTER_RUNS,
  FILTER_THRESHOLD,
  SPAN_STEP_CONTEXT_SENTENCES,
  POST_FIND_BATCH_SIZE,
  POST_FIND_CONCURRENCY,
} from "./def"
import { errorMessage } from "~/lib/utils/error"

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface DimensionResult {
  spans: FindResult[]
  findVotes: Map<string, boolean[]>
  errors: string[]
}

const countUniqueSentences = (spans: FindResult[]): number => {
  const seen = new Set<number>()
  for (const s of spans) {
    for (let i = s.start; i <= s.end; i++) seen.add(i)
  }
  return seen.size
}

const tryParseJson = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const callAndParse = async <T>(
  endpoint: string,
  messages: { type: "message"; role: "system" | "user"; content: string }[],
  schema: z.ZodType<T>
): Promise<CallResult<T>> => {
  const blocks = await callLlm({
    endpoint,
    messages,
    responseFormat: toResponseFormat(schema),
  })

  const text = extractText(blocks)
  if (!text) return { ok: false, error: "LLM returned no text response" }

  const raw = tryParseJson(text)
  if (raw === undefined) return { ok: false, error: "LLM returned invalid JSON" }

  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    return { ok: false, error: `Schema validation failed: ${parsed.error.message}` }

  return { ok: true, data: parsed.data }
}

const runFindRuns = async (
  messages: { type: "message"; role: "system" | "user"; content: string }[],
  schema: z.ZodType<{ results: FindResult[] }>
): Promise<{ runs: FindResult[][]; errors: string[] }> => {
  const errors: string[] = []
  const findSlots = Array.from({ length: FIND_RUNS }, (_, i) => i)
  const { results, failures } = await processPool<number, FindResult[]>(
    findSlots,
    async (slot) => {
      const endpoint = `${FIND_ENDPOINT}?model=${slot % 2}`
      const result = await callAndParse(endpoint, messages, schema)
      if (!result.ok) {
        errors.push(result.error)
        return []
      }
      return [result.data.results]
    },
    noop,
    // warmup: 2 — primes prompt cache for both model=0 and model=1 before the parallel burst
    { concurrency: 3, warmup: 2 }
  )
  for (const f of failures) errors.push(errorMessage(f.error))
  return { runs: results, errors }
}

const collectCodeIds = (spans: CodedSpan[]): Set<string> => {
  const ids = new Set<string>()
  for (const s of spans) for (const c of s.codings) ids.add(c)
  return ids
}

const toCodedItems = (spans: CodedSpan[]): CodedItem[] =>
  spans.map((s) => ({ start: s.start, end: s.end, codings: s.codings }))

const buildSpanStepSchema = (validCodes: string[]) =>
  z.object({
    results: z.array(
      z.object({
        id: z.number().int().min(1),
        code: validCodes.length > 0 ? z.enum(validCodes as [string, ...string[]]) : z.string(),
        justification: z.string(),
      })
    ),
  })

const runSpanStep = async (
  label: string,
  items: CodedSpan[],
  endpoint: string,
  cta: string,
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<{ values: Map<string, string>; error?: string }> => {
  if (items.length === 0) return { values: new Map() }

  const codeIds = collectCodeIds(items)
  const codedItems = toCodedItems(items)
  const { text: presented, mapping } = formatCodedSection(
    sentences,
    codedItems,
    SPAN_STEP_CONTEXT_SENTENCES
  )

  const messages = buildSpanStepMessages(
    presented,
    codeIds,
    sources,
    leadingCtx,
    trailingCtx,
    resolve,
    cta
  )

  const validCodes = [...codeIds]
  const schema = buildSpanStepSchema(validCodes)
  const result = await callAndParse(endpoint, messages, schema)

  if (!result.ok) {
    console.debug(`[deep-analysis] ${label} failed: ${result.error}`)
    return { values: new Map(), error: result.error }
  }

  const values = new Map<string, string>()
  for (const r of result.data.results) {
    const m = mapping.find((entry) => entry.index === r.id)
    if (!m) continue
    const key = spanKey(m.start, m.end, r.code)
    values.set(key, r.justification)
  }

  if (values.size > 0) {
    console.debug(`[deep-analysis] ${label}: ${values.size} span(s)`)
  }

  return { values }
}

const batchItems = <T>(items: T[], size: number): T[][] => {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

export interface BatchPhaseNotifier {
  setBatchCount: (n: number) => void
  enterFilter: () => void
  enterAdjudicate: () => void
  enterReason: () => void
  exitBatch: () => void
}

export interface PostFindResult {
  surviving: FindResult[]
  dropped: FindResult[]
  filterVotes: Map<string, boolean[]>
  filterJustifications: Map<string, string[]>
  reviews: Map<string, string>
  reasons: Map<string, string>
  errors: string[]
}

interface FilterHit {
  key: string
  justification: string
}

const mapFilterResults = (
  results: { id: number; code: string; removalJustification: string }[],
  mapping: { index: number; start: number; end: number }[]
): FilterHit[] =>
  results.flatMap((r) => {
    const m = mapping.find((entry) => entry.index === r.id)
    return m
      ? [{ key: spanKey(m.start, m.end, r.code), justification: r.removalJustification }]
      : []
  })

const runFilterBatch = async (
  batchSpans: FindResult[],
  grouped: CodedSpan[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<{
  surviving: FindResult[]
  dropped: FindResult[]
  filterVotes: Map<string, boolean[]>
  filterJustifications: Map<string, string[]>
  errors: string[]
}> => {
  const codeIds = collectCodeIds(grouped)
  const codedItems = toCodedItems(grouped)
  const { text: presented, mapping } = formatCodedSection(
    sentences,
    codedItems,
    SPAN_STEP_CONTEXT_SENTENCES
  )

  const messages = buildSpanStepMessages(
    presented,
    codeIds,
    sources,
    leadingCtx,
    trailingCtx,
    resolve,
    FILTER_CTA
  )

  const validCodes = [...codeIds]
  const schema = buildFilterSchema(validCodes)
  const errors: string[] = []
  const slots = Array.from({ length: FILTER_RUNS }, (_, i) => i)
  const { results: rawRuns, failures } = await processPool<number, FilterHit[]>(
    slots,
    async (slot) => {
      const endpoint = `${FILTER_ENDPOINT}?model=${slot % 2}`
      const result = await callAndParse(endpoint, messages, schema)
      if (!result.ok) {
        errors.push(result.error)
        return []
      }
      return [mapFilterResults(result.data.results, mapping)]
    },
    noop,
    { concurrency: 3 }
  )
  for (const f of failures) errors.push(errorMessage(f.error))

  if (rawRuns.length === 0) {
    return {
      surviving: batchSpans,
      dropped: [],
      filterVotes: new Map(),
      filterJustifications: new Map(),
      errors,
    }
  }

  const keyRuns = rawRuns.map((hits) => hits.map((h) => h.key))
  const votes = countKeys(keyRuns)
  const rejected = new Set(
    [...votes.entries()].filter(([, v]) => v >= FILTER_THRESHOLD).map(([k]) => k)
  )

  const allSpanKeys = new Set(batchSpans.map((s) => spanKey(s.start, s.end, s.analysis_source_id)))
  const filterVotes = new Map<string, boolean[]>()
  for (const key of allSpanKeys) {
    const perVoter = rawRuns.map((hits) => !hits.some((h) => h.key === key))
    filterVotes.set(key, perVoter)
  }

  const filterJustifications = new Map<string, string[]>()
  for (const key of allSpanKeys) {
    if (rejected.has(key)) continue
    const dissent = rawRuns.flatMap((hits) => hits.filter((h) => h.key === key))
    if (dissent.length > 0) {
      filterJustifications.set(
        key,
        dissent.map((d) => d.justification)
      )
    }
  }

  const surviving: FindResult[] = []
  const dropped: FindResult[] = []
  for (const span of batchSpans) {
    const key = spanKey(span.start, span.end, span.analysis_source_id)
    if (rejected.has(key)) {
      dropped.push(span)
    } else {
      surviving.push(span)
    }
  }

  return { surviving, dropped, filterVotes, filterJustifications, errors }
}

const runAdjudicateBatch = async (
  disputedSpans: FindResult[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<{
  surviving: FindResult[]
  removed: FindResult[]
  reviews: Map<string, string>
  errors: string[]
}> => {
  if (disputedSpans.length === 0)
    return { surviving: [], removed: [], reviews: new Map(), errors: [] }

  const grouped = groupBySpan(disputedSpans)
  const codeIds = collectCodeIds(grouped)
  const codedItems = toCodedItems(grouped)
  const { text: presented, mapping } = formatCodedSection(
    sentences,
    codedItems,
    SPAN_STEP_CONTEXT_SENTENCES
  )

  const messages = buildSpanStepMessages(
    presented,
    codeIds,
    sources,
    leadingCtx,
    trailingCtx,
    resolve,
    ADJUDICATE_CTA
  )

  const validCodes = [...codeIds]
  const schema = buildAdjudicateSchema(validCodes)
  const result = await callAndParse(ADJUDICATE_ENDPOINT, messages, schema)

  if (!result.ok) {
    return { surviving: disputedSpans, removed: [], reviews: new Map(), errors: [result.error] }
  }

  const surviving: FindResult[] = []
  const removed: FindResult[] = []
  const reviews = new Map<string, string>()

  const judgmentByKey = new Map<string, { judgment: string; reason: string }>()
  for (const r of result.data.results) {
    const m = mapping.find((entry) => entry.index === r.id)
    if (!m) continue
    judgmentByKey.set(spanKey(m.start, m.end, r.code), { judgment: r.judgment, reason: r.reason })
  }

  for (const span of disputedSpans) {
    const key = spanKey(span.start, span.end, span.analysis_source_id)
    const entry = judgmentByKey.get(key)
    if (!entry || entry.judgment === "keep") {
      surviving.push(span)
    } else if (entry.judgment === "remove") {
      removed.push(span)
    } else {
      surviving.push(span)
      reviews.set(key, entry.reason)
    }
  }

  return { surviving, removed, reviews, errors: [] }
}

const spansForBatch = (allSpans: FindResult[], batch: CodedSpan[]): FindResult[] => {
  const keys = new Set<string>()
  for (const cs of batch) {
    for (const code of cs.codings) keys.add(spanKey(cs.start, cs.end, code))
  }
  return allSpans.filter((s) => keys.has(spanKey(s.start, s.end, s.analysis_source_id)))
}

interface BatchResult {
  surviving: FindResult[]
  dropped: FindResult[]
  filterVotes: Map<string, boolean[]>
  filterJustifications: Map<string, string[]>
  reviews: Map<string, string>
  reasons: Map<string, string>
  errors: string[]
}

const runBatch = async (
  batch: CodedSpan[],
  allSpans: FindResult[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver,
  notify: BatchPhaseNotifier
): Promise<BatchResult> => {
  const batchSpans = spansForBatch(allSpans, batch)

  notify.enterFilter()
  const filterResult = await runFilterBatch(
    batchSpans,
    batch,
    sentences,
    sources,
    leadingCtx,
    trailingCtx,
    resolve
  )

  const isDisputed = (s: FindResult) =>
    filterResult.filterJustifications.has(spanKey(s.start, s.end, s.analysis_source_id))
  const disputedSpans = filterResult.surviving.filter(isDisputed)
  const undisputedSpans = filterResult.surviving.filter((s) => !isDisputed(s))

  notify.enterAdjudicate()
  const adjResult = await runAdjudicateBatch(
    disputedSpans,
    sentences,
    sources,
    leadingCtx,
    trailingCtx,
    resolve
  )

  const surviving = [...undisputedSpans, ...adjResult.surviving]
  const dropped = [...filterResult.dropped, ...adjResult.removed]

  notify.enterReason()
  const reasonResult = await runSpanStep(
    "reason",
    groupBySpan(surviving),
    REASON_ENDPOINT,
    REASON_CTA,
    sentences,
    sources,
    leadingCtx,
    trailingCtx,
    resolve
  )

  notify.exitBatch()

  const errors = [
    ...filterResult.errors,
    ...adjResult.errors,
    ...(reasonResult.error ? [reasonResult.error] : []),
  ]

  return {
    surviving,
    dropped,
    filterVotes: filterResult.filterVotes,
    filterJustifications: filterResult.filterJustifications,
    reviews: adjResult.reviews,
    reasons: reasonResult.values,
    errors,
  }
}

const EMPTY_POST_FIND: PostFindResult = {
  surviving: [],
  dropped: [],
  filterVotes: new Map(),
  filterJustifications: new Map(),
  reviews: new Map(),
  reasons: new Map(),
  errors: [],
}

const mergeBatchResults = (batchResults: BatchResult[]): PostFindResult => {
  const surviving: FindResult[] = []
  const dropped: FindResult[] = []
  const filterVotes = new Map<string, boolean[]>()
  const filterJustifications = new Map<string, string[]>()
  const reviews = new Map<string, string>()
  const reasons = new Map<string, string>()
  const errors: string[] = []

  for (const br of batchResults) {
    surviving.push(...br.surviving)
    dropped.push(...br.dropped)
    for (const [k, v] of br.filterVotes) filterVotes.set(k, v)
    for (const [k, v] of br.filterJustifications) filterJustifications.set(k, v)
    for (const [k, v] of br.reviews) reviews.set(k, v)
    for (const [k, v] of br.reasons) reasons.set(k, v)
    errors.push(...br.errors)
  }

  return { surviving, dropped, filterVotes, filterJustifications, reviews, reasons, errors }
}

export const runPostFindPipeline = async (
  allSpans: FindResult[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver,
  notify: BatchPhaseNotifier
): Promise<PostFindResult> => {
  const grouped = groupBySpan(allSpans)
  if (grouped.length === 0) return EMPTY_POST_FIND

  const batches = batchItems(grouped, POST_FIND_BATCH_SIZE)
  notify.setBatchCount(batches.length)
  console.debug(`[deep-analysis] post-find: ${grouped.length} spans → ${batches.length} batch(es)`)

  const { results: batchResults, failures } = await processPool<CodedSpan[], BatchResult>(
    batches,
    async (batch) => {
      const result = await runBatch(
        batch,
        allSpans,
        sentences,
        sources,
        leadingCtx,
        trailingCtx,
        resolve,
        notify
      )
      return [result]
    },
    noop,
    { concurrency: POST_FIND_CONCURRENCY }
  )

  const failErrors = failures.map((f) => errorMessage(f.error))
  const merged = mergeBatchResults(batchResults)
  merged.errors.push(...failErrors)

  console.debug(
    `[deep-analysis] post-find result: ${merged.surviving.length} surviving, ${merged.dropped.length} dropped`
  )

  return merged
}

export const runDimensionPipeline = async (
  sources: ScopedSources,
  rawTarget: string,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<DimensionResult> => {
  const { messages: findMessages, sentences } = buildFindCall(
    rawTarget,
    sources,
    resolve,
    leadingCtx,
    trailingCtx
  )

  const validIds = extractSourceIds(sources, resolve)
  const findSchema = buildFindResultSchema(validIds)

  const { runs: findRuns, errors } = await runFindRuns(findMessages, findSchema)

  const findPerRun = findRuns.map((run, i) => `run-${i}(m${i % 2}):${run.length}`).join(", ")
  console.debug(`[deep-analysis] find runs: ${findPerRun}`)
  const modelCounts = [0, 1].map((m) => {
    const total = findRuns.reduce((sum, r, i) => sum + (i % 2 === m ? r.length : 0), 0)
    const runCount = findRuns.filter((_, i) => i % 2 === m).length
    return `m${m} ${total} sections (${runCount} runs)`
  })
  console.debug(`[deep-analysis] find models: ${modelCounts.join(", ")}`)

  if (findRuns.length === 0) {
    console.debug(`[deep-analysis] consensus: 0/${FIND_RUNS} runs — all failed`)
    return { spans: [], findVotes: new Map(), errors }
  }

  if (findRuns.length < FIND_RUNS) {
    console.debug(
      `[deep-analysis] consensus: ${findRuns.length}/${FIND_RUNS} runs (${FIND_RUNS - findRuns.length} dropped)`
    )
  }

  const tally = tallyVotes(findRuns, sentences.length)
  const spans = filterByTally(tally, FIND_THRESHOLD, FIND_MAX_GAP)

  const titles = buildSourceTitleMap(sources, resolve)
  const perCode = [...tally.entries()].map(([code, votesMap]) => {
    const voted = votesMap.size
    const survived = countUniqueSentences(spans.filter((s) => s.analysis_source_id === code))
    const name = titles.get(code) ?? code
    return `${name} ${voted}→${survived}`
  })
  console.debug(
    `[deep-analysis] consensus (${FIND_THRESHOLD}/${FIND_RUNS}): ${perCode.join(", ") || "no votes"}`
  )
  console.debug(`[deep-analysis] find → next: ${spans.length} spans`)

  if (spans.length === 0) return { spans: [], findVotes: new Map(), errors }

  const findVotes = buildFindVoteMap(tally, spans, spanKey)

  const codedSpans = groupBySpan(spans)
  for (const cs of codedSpans) {
    console.debug(`[deep-analysis]   [${cs.start}-${cs.end}] ${cs.codings.join(", ")}`)
  }

  return { spans, findVotes, errors }
}

export const mergeDimensionResults = (results: DimensionResult[]) => {
  const allSpans: FindResult[] = []
  const allFindVotes = new Map<string, boolean[]>()
  const errors: string[] = []

  for (const dr of results) {
    allSpans.push(...dr.spans)
    for (const [k, v] of dr.findVotes) allFindVotes.set(k, v)
    errors.push(...dr.errors)
  }

  return { allSpans, allFindVotes, errors }
}
