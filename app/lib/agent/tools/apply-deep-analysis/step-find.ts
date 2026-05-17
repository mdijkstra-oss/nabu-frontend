import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import type { FindResult } from "./consensus"
import { callAndParse } from "../../client/call-parse"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import {
  buildFindCall,
  buildFindResultSchema,
  extractSourceIds,
  buildSourceTitleMap,
} from "./messages"
import { tallyVotes, filterByTally, groupBySpan, buildFindVoteMap } from "./consensus"
import { spanKey } from "./format"
import { FIND_ENDPOINT, FIND_RUNS, FIND_THRESHOLD, FIND_MAX_GAP } from "./def"

export interface FindStepResult {
  annotations: Annotation[]
  errors: string[]
}

const countUniqueSentences = (spans: FindResult[], code: string): number => {
  const seen = new Set<number>()
  for (const s of spans) {
    if (s.analysis_source_id !== code) continue
    for (let i = s.start; i <= s.end; i++) seen.add(i)
  }
  return seen.size
}

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

const toAnnotations = (spans: FindResult[], findVotes: Map<string, boolean[]>): Annotation[] =>
  spans.map((s) => ({
    start: s.start,
    end: s.end,
    code: s.analysis_source_id,
    findVotes: findVotes.get(spanKey(s.start, s.end, s.analysis_source_id)) ?? [],
    filterVotes: [],
    reason: "",
  }))

export const findAnnotations = async (
  sources: ScopedSources,
  rawTarget: string,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<FindStepResult> => {
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
    return { annotations: [], errors }
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
    const survived = countUniqueSentences(spans, code)
    const name = titles.get(code) ?? code
    return `${name} ${voted}→${survived}`
  })
  console.debug(
    `[deep-analysis] consensus (${FIND_THRESHOLD}/${FIND_RUNS}): ${perCode.join(", ") || "no votes"}`
  )
  console.debug(`[deep-analysis] find → next: ${spans.length} spans`)

  if (spans.length === 0) return { annotations: [], errors }

  const findVotes = buildFindVoteMap(tally, spans, spanKey)

  const codedSpans = groupBySpan(spans)
  for (const cs of codedSpans) {
    console.debug(`[deep-analysis]   [${cs.start}-${cs.end}] ${cs.codings.join(", ")}`)
  }

  return { annotations: toAnnotations(spans, findVotes), errors }
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
