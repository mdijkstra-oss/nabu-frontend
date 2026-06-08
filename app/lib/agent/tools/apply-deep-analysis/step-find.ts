import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import type { FindResult } from "./consensus"
import { callAndParse } from "../../client/call-parse"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { think, FINDING, CONSENSUS } from "./thoughts"
import { buildFindCall, buildPrefixedFindSchema, extractSourceIds } from "./messages"
import { resolveToGlobal } from "./format"
import { filterOverlappingSpans } from "./consensus"
import { collapseRunsByOverlap } from "~/lib/text/spans"
import { FIND_ENDPOINT, FIND_RUNS, FIND_CONCURRENCY } from "./def"

export type FindStats = Map<string, [number, number]>

export interface FindStepResult {
  annotations: Annotation[]
  errors: string[]
  stats: FindStats
}

interface FindSlot {
  callIdx: number
  sources: ScopedSources
  runIdx: number
}

interface SlotResult {
  callIdx: number
  runIdx: number
  code: string
  spans: FindResult[]
}

const AGREEMENT_THRESHOLD = 0.8

const toAnnotation = (span: FindResult, votes: boolean[]): Annotation => ({
  start: span.start,
  end: span.end,
  code: span.analysis_source_id,
  findVotes: votes,
  reason: "",
})

const groupRunsByCode = (runs: FindResult[][]): Map<string, FindResult[][]> => {
  const byCode = new Map<string, FindResult[][]>()
  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    for (const span of runs[runIdx]) {
      const code = span.analysis_source_id
      const perRun = byCode.get(code) ?? Array.from({ length: runs.length }, (): FindResult[] => [])
      perRun[runIdx].push(span)
      byCode.set(code, perRun)
    }
  }
  return byCode
}

const voteSpans = (runs: FindResult[][]): Annotation[] => {
  const annotations: Annotation[] = []
  for (const [code, perRun] of groupRunsByCode(runs)) {
    const collapsed = collapseRunsByOverlap(perRun, AGREEMENT_THRESHOLD)
    for (const { span, votes } of collapsed) {
      annotations.push(toAnnotation({ ...span, analysis_source_id: code }, votes))
    }
  }
  return annotations
}

const buildFindSlots = (calls: ScopedSources[]): FindSlot[] =>
  calls.flatMap((sources, callIdx) =>
    Array.from({ length: FIND_RUNS }, (_, runIdx) => ({ callIdx, sources, runIdx }))
  )

const groupSlotResults = (results: SlotResult[], callCount: number): FindResult[][][] =>
  results.reduce<FindResult[][][]>(
    (grouped, { callIdx, spans }) => {
      grouped[callIdx].push(spans)
      return grouped
    },
    Array.from({ length: callCount }, () => [])
  )

const executeFindSlot = async (
  slot: FindSlot,
  rawTarget: string,
  firstFile: string,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<SlotResult> => {
  const { messages, prefixes } = buildFindCall(
    rawTarget,
    slot.sources,
    resolve,
    leadingCtx,
    trailingCtx,
    firstFile
  )
  const sourceId = extractSourceIds(slot.sources, resolve)[0] ?? ""
  const files = [...new Set(prefixes.map((p) => p.file))]
  const schema = buildPrefixedFindSchema(files)
  const endpoint = `${FIND_ENDPOINT}?model=${slot.runIdx % 2}`
  const result = await callAndParse(endpoint, messages, schema)
  if (!result.ok) throw new Error(result.error)
  return {
    callIdx: slot.callIdx,
    runIdx: slot.runIdx,
    code: sourceId,
    spans: result.data.results.flatMap((r) => {
      const start = resolveToGlobal(r.start, prefixes)
      const end = resolveToGlobal(r.end, prefixes)
      if (start === null || end === null) return []
      return [{ start, end, analysis_source_id: sourceId }]
    }),
  }
}

const MODEL_COUNT = 2

const modelOf = (runIdx: number): number => runIdx % MODEL_COUNT

const tallyFindStats = (results: readonly SlotResult[]): FindStats => {
  const stats: FindStats = new Map()
  for (const { code, runIdx, spans } of results) {
    if (!code) continue
    const entry = stats.get(code) ?? [0, 0]
    entry[modelOf(runIdx)] += spans.length
    stats.set(code, entry)
  }
  return stats
}

export const findAllDimensions = async (
  calls: ScopedSources[],
  rawTarget: string,
  firstFile: string,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<FindStepResult> => {
  think(FINDING)

  const slots = buildFindSlots(calls)

  const { results: slotResults, failures } = await processPool<FindSlot, SlotResult>(
    slots,
    async (slot) => [
      await executeFindSlot(slot, rawTarget, firstFile, leadingCtx, trailingCtx, resolve),
    ],
    noop,
    { concurrency: FIND_CONCURRENCY, warmup: FIND_RUNS }
  )

  const errors: string[] = []
  for (const f of failures) errors.push(errorMessage(f.error))

  const stats = tallyFindStats(slotResults)
  const runsPerCall = groupSlotResults(slotResults, calls.length)

  think(CONSENSUS)
  const allAnnotations: Annotation[] = []

  for (const runs of runsPerCall) {
    if (runs.length === 0) continue
    allAnnotations.push(...voteSpans(runs))
  }

  const filtered = filterOverlappingSpans(allAnnotations)

  return { annotations: filtered, errors, stats }
}
