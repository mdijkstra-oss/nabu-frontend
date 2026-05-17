import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import type { FindResult } from "./consensus"
import { callAndParse } from "../../client/call-parse"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { think, FINDING, CONSENSUS } from "./thoughts"
import { buildFindCall, buildFindResultSchema, extractSourceIds } from "./messages"
import { groupBySpan } from "./consensus"
import { spanKey } from "./format"
import { FIND_ENDPOINT, FIND_RUNS } from "./def"

export interface FindStepResult {
  annotations: Annotation[]
  errors: string[]
}

interface DedupedSpan {
  span: FindResult
  votes: boolean[]
}

const deduplicateSpans = (runs: FindResult[][]): DedupedSpan[] => {
  const map = new Map<string, DedupedSpan>()
  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    for (const s of runs[runIdx]) {
      const key = spanKey(s.start, s.end, s.analysis_source_id)
      const existing = map.get(key)
      if (existing) {
        existing.votes[runIdx] = true
      } else {
        const votes = Array.from({ length: runs.length }, () => false)
        votes[runIdx] = true
        map.set(key, { span: s, votes })
      }
    }
  }
  return [...map.values()]
}

const OVERLAP_THRESHOLD = 0.2

const spanLength = (s: FindResult): number => s.end - s.start + 1

const overlapCount = (a: FindResult, b: FindResult): number => {
  const start = Math.max(a.start, b.start)
  const end = Math.min(a.end, b.end)
  return end >= start ? end - start + 1 : 0
}

const isSignificantOverlap = (a: FindResult, b: FindResult): boolean => {
  const overlap = overlapCount(a, b)
  const smaller = Math.min(spanLength(a), spanLength(b))
  return overlap / smaller > OVERLAP_THRESHOLD
}

const collapseOverlapping = (spans: DedupedSpan[]): DedupedSpan[] => {
  const byCode = new Map<string, DedupedSpan[]>()
  for (const d of spans) {
    const group = byCode.get(d.span.analysis_source_id) ?? []
    group.push(d)
    byCode.set(d.span.analysis_source_id, group)
  }

  const result: DedupedSpan[] = []
  for (const group of byCode.values()) {
    const sorted = [...group].sort((a, b) => spanLength(a.span) - spanLength(b.span))
    const accepted: DedupedSpan[] = []
    for (const d of sorted) {
      const dominated = accepted.some((a) => isSignificantOverlap(a.span, d.span))
      if (!dominated) accepted.push(d)
    }
    result.push(...accepted)
  }
  return result
}

const dedupedToAnnotation = (d: DedupedSpan): Annotation => ({
  start: d.span.start,
  end: d.span.end,
  code: d.span.analysis_source_id,
  findVotes: d.votes,
  filterVotes: [],
  reason: "",
})

const runFindRuns = async (
  messages: { type: "message"; role: "system" | "user"; content: string }[],
  schema: ReturnType<typeof buildFindResultSchema>
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
    { concurrency: 3, warmup: 2 }
  )
  for (const f of failures) errors.push(errorMessage(f.error))
  return { runs: results, errors }
}

export const findAnnotations = async (
  sources: ScopedSources,
  rawTarget: string,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<FindStepResult> => {
  think(FINDING)

  const { messages: findMessages } = buildFindCall(
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
    return { annotations: [], errors }
  }

  if (findRuns.length < FIND_RUNS) {
    console.debug(
      `[deep-analysis] consensus: ${findRuns.length}/${FIND_RUNS} runs (${FIND_RUNS - findRuns.length} dropped)`
    )
  }

  think(CONSENSUS)
  const deduped = collapseOverlapping(deduplicateSpans(findRuns))

  const codedSpans = groupBySpan(deduped.map((d) => d.span))
  for (const cs of codedSpans) {
    console.debug(`[deep-analysis]   [${cs.start}-${cs.end}] ${cs.codings.join(", ")}`)
  }
  console.debug(`[deep-analysis] find → next: ${deduped.length} spans`)

  if (deduped.length === 0) return { annotations: [], errors }

  return { annotations: deduped.map(dedupedToAnnotation), errors }
}

export const findAllDimensions = async (
  calls: ScopedSources[],
  rawTarget: string,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<FindStepResult> => {
  const { results: dimensionResults } = await processPool<ScopedSources, FindStepResult>(
    calls,
    async (sources) => [
      await findAnnotations(sources, rawTarget, leadingCtx, trailingCtx, resolve),
    ],
    noop,
    { concurrency: 5 }
  )

  const allAnnotations: Annotation[] = []
  const allErrors: string[] = []
  for (const dr of dimensionResults) {
    allAnnotations.push(...dr.annotations)
    allErrors.push(...dr.errors)
  }

  return { annotations: allAnnotations, errors: allErrors }
}
