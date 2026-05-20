import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import type { FindResult } from "./consensus"
import { callAndParse } from "../../client/call-parse"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { think, FINDING, CONSENSUS } from "./thoughts"
import { buildFindCall, singleIdFindSchema, extractSourceIds } from "./messages"
import { groupBySpan, filterContainedSpans } from "./consensus"
import { FIND_ENDPOINT, FIND_RUNS, FIND_CONCURRENCY } from "./def"

export interface FindStepResult {
  annotations: Annotation[]
  errors: string[]
}

interface VotedSpan {
  span: FindResult
  runIdx: number
}

interface FindSlot {
  callIdx: number
  sources: ScopedSources
  runIdx: number
}

interface SlotResult {
  callIdx: number
  spans: FindResult[]
}

const AGREEMENT_THRESHOLD = 0.8

const spanLength = (s: FindResult): number => s.end - s.start + 1

const overlapCount = (a: FindResult, b: FindResult): number => {
  const start = Math.max(a.start, b.start)
  const end = Math.min(a.end, b.end)
  return end >= start ? end - start + 1 : 0
}

const overlapRatio = (a: FindResult, b: FindResult): number => {
  const smaller = Math.min(spanLength(a), spanLength(b))
  return smaller === 0 ? 0 : overlapCount(a, b) / smaller
}

const toAnnotation = (span: FindResult, votes: boolean[]): Annotation => ({
  start: span.start,
  end: span.end,
  code: span.analysis_source_id,
  findVotes: votes,
  reason: "",
})

const voteSpans = (runs: FindResult[][]): Annotation[] => {
  const byCode = new Map<string, VotedSpan[]>()
  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    for (const span of runs[runIdx]) {
      const group = byCode.get(span.analysis_source_id) ?? []
      group.push({ span, runIdx })
      byCode.set(span.analysis_source_id, group)
    }
  }

  const annotations: Annotation[] = []

  for (const [code, spans] of byCode) {
    const perRun: VotedSpan[][] = Array.from({ length: runs.length }, () => [])
    for (const vs of spans) perRun[vs.runIdx].push(vs)

    const matchedSets = perRun.map(() => new Set<number>())

    for (let ri = 0; ri < runs.length - 1; ri++) {
      for (let i = 0; i < perRun[ri].length; i++) {
        if (matchedSets[ri].has(i)) continue
        for (let rj = ri + 1; rj < runs.length; rj++) {
          let bestJ = -1
          let bestOverlap = 0
          for (let j = 0; j < perRun[rj].length; j++) {
            if (matchedSets[rj].has(j)) continue
            const ratio = overlapRatio(perRun[ri][i].span, perRun[rj][j].span)
            if (ratio >= AGREEMENT_THRESHOLD && ratio > bestOverlap) {
              bestOverlap = ratio
              bestJ = j
            }
          }
          if (bestJ >= 0) {
            matchedSets[ri].add(i)
            matchedSets[rj].add(bestJ)
            const a = perRun[ri][i].span
            const b = perRun[rj][bestJ].span
            const smallest = spanLength(a) <= spanLength(b) ? a : b
            const votes = Array.from({ length: runs.length }, () => false)
            votes[ri] = true
            votes[rj] = true
            annotations.push(toAnnotation({ ...smallest, analysis_source_id: code }, votes))
            break
          }
        }
      }
    }

    for (let ri = 0; ri < runs.length; ri++) {
      for (let i = 0; i < perRun[ri].length; i++) {
        if (matchedSets[ri].has(i)) continue
        const votes = Array.from({ length: runs.length }, () => false)
        votes[ri] = true
        annotations.push(toAnnotation({ ...perRun[ri][i].span, analysis_source_id: code }, votes))
      }
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
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<SlotResult> => {
  const { messages } = buildFindCall(rawTarget, slot.sources, resolve, leadingCtx, trailingCtx)
  const sourceId = extractSourceIds(slot.sources, resolve)[0] ?? ""
  const endpoint = `${FIND_ENDPOINT}?model=${slot.runIdx % 2}`
  const result = await callAndParse(endpoint, messages, singleIdFindSchema)
  if (!result.ok) throw new Error(result.error)
  return {
    callIdx: slot.callIdx,
    spans: result.data.results.map((r) => ({ ...r, analysis_source_id: sourceId })),
  }
}

export const findAllDimensions = async (
  calls: ScopedSources[],
  rawTarget: string,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<FindStepResult> => {
  think(FINDING)

  const slots = buildFindSlots(calls)

  const { results: slotResults, failures } = await processPool<FindSlot, SlotResult>(
    slots,
    async (slot) => [await executeFindSlot(slot, rawTarget, leadingCtx, trailingCtx, resolve)],
    noop,
    { concurrency: FIND_CONCURRENCY, warmup: FIND_RUNS }
  )

  const errors: string[] = []
  for (const f of failures) errors.push(errorMessage(f.error))

  const runsPerCall = groupSlotResults(slotResults, calls.length)

  think(CONSENSUS)
  const allAnnotations: Annotation[] = []

  for (let callIdx = 0; callIdx < runsPerCall.length; callIdx++) {
    const runs = runsPerCall[callIdx]
    const runSummary = runs.map((r, i) => `run-${i}(m${i % 2}):${r.length}`).join(", ")
    console.debug(`[deep-analysis] call-${callIdx} find: ${runSummary}`)

    if (runs.length === 0) continue

    allAnnotations.push(...voteSpans(runs))
  }

  const filtered = filterContainedSpans(allAnnotations)

  console.debug(`[deep-analysis] containment filter: ${allAnnotations.length} → ${filtered.length}`)

  const codedSpans = groupBySpan(
    filtered.map((a) => ({ start: a.start, end: a.end, analysis_source_id: a.code }))
  )
  for (const cs of codedSpans) {
    console.debug(`[deep-analysis]   [${cs.start}-${cs.end}] ${cs.codings.join(", ")}`)
  }
  console.debug(`[deep-analysis] find → ${filtered.length} annotations`)

  return { annotations: filtered, errors }
}
