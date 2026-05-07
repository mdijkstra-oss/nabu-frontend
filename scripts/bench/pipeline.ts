import { z } from "zod"
import {
  type ScopedSources,
  type ContentResolver,
  buildFindCall,
  buildFindResultSchema,
  buildFilterSchema,
  buildSpanStepMessages,
  extractSourceIds,
  buildSourceTitleMap,
  REASON_CTA,
  FILTER_CTA,
  partitionSources,
  buildCallList,
} from "~/lib/agent/tools/apply-deep-analysis/messages"
import {
  tallyVotes,
  filterByTally,
  groupBySpan,
  countKeys,
  type FindResult,
  type CodedSpan,
} from "~/lib/agent/tools/apply-deep-analysis/consensus"
import { formatCodedSection, type CodedItem } from "~/lib/agent/tools/apply-deep-analysis/present"
import {
  spanKey,
  extractSection,
  extractLeadingContext,
  extractTrailingContext,
  prepareTargetContent,
  numberSection,
  toAnalysisResults,
  mapResults,
  type AnalysisResult,
} from "~/lib/agent/tools/apply-deep-analysis/format"
import {
  FIND_ENDPOINT,
  REASON_ENDPOINT,
  FILTER_ENDPOINT,
  FIND_RUNS,
  FIND_THRESHOLD,
  FILTER_RUNS,
  FILTER_THRESHOLD,
  SPAN_STEP_CONTEXT_SENTENCES,
  type SourceFile,
} from "~/lib/agent/tools/apply-deep-analysis/def"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { chunkLines, CHUNK_TARGET_CHARS, CONTEXT_OVERLAP_CHARS } from "~/lib/data-blocks/chunk-lines"
import { callAndParse, type CallResult } from "./client"
import type { CallRecord, SectionResult } from "./types"

export { partitionSources, buildCallList }
export type { ContentResolver, ScopedSources }

interface PipelineConfig {
  host: string
  calls: CallRecord[]
}

interface DimensionResult {
  spans: FindResult[]
  errors: string[]
}

const runFindRuns = async (
  host: string,
  messages: { type: "message"; role: "system" | "user"; content: string }[],
  schema: z.ZodType<{ results: FindResult[] }>,
  calls: CallRecord[]
): Promise<{ runs: FindResult[][]; errors: string[] }> => {
  const errors: string[] = []
  const slots = Array.from({ length: FIND_RUNS }, (_, i) => i)
  const { results } = await processPool<number, FindResult[]>(
    slots,
    async () => {
      const result = await callAndParse(host, FIND_ENDPOINT, messages, schema, calls)
      if (!result.ok) {
        errors.push(result.error)
        return []
      }
      return [result.data.results]
    },
    noop,
    { concurrency: 3, warmup: 1 }
  )
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
  resolve: ContentResolver,
  config: PipelineConfig
): Promise<{ values: Map<string, string>; error?: string }> => {
  if (items.length === 0) return { values: new Map() }

  const codeIds = collectCodeIds(items)
  const codedItems = toCodedItems(items)
  const { text: presented, mapping } = formatCodedSection(sentences, codedItems, SPAN_STEP_CONTEXT_SENTENCES)
  const messages = buildSpanStepMessages(presented, codeIds, sources, leadingCtx, trailingCtx, resolve, cta)
  const validCodes = [...codeIds]
  const schema = buildSpanStepSchema(validCodes)
  const result = await callAndParse(config.host, endpoint, messages, schema, config.calls)

  if (!result.ok) {
    console.debug(`[bench] ${label} failed: ${result.error}`)
    return { values: new Map(), error: result.error }
  }

  const values = new Map<string, string>()
  for (const r of result.data.results) {
    const m = mapping.find((entry) => entry.index === r.id)
    if (!m) continue
    const key = spanKey(m.start, m.end, r.code)
    values.set(key, r.justification)
  }

  return { values }
}

const runReasonStep = async (
  allSpans: FindResult[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver,
  config: PipelineConfig
): Promise<{ values: Map<string, string>; error?: string }> => {
  const grouped = groupBySpan(allSpans)
  return runSpanStep("reason", grouped, REASON_ENDPOINT, REASON_CTA, sentences, sources, leadingCtx, trailingCtx, resolve, config)
}

const mapFilterResults = (
  results: { id: number; code: string }[],
  mapping: { index: number; start: number; end: number }[]
): string[] =>
  results.flatMap((r) => {
    const m = mapping.find((entry) => entry.index === r.id)
    return m ? [spanKey(m.start, m.end, r.code)] : []
  })

const runFilter = async (
  allSpans: FindResult[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver,
  config: PipelineConfig
): Promise<{ surviving: FindResult[]; dropped: FindResult[] }> => {
  const grouped = groupBySpan(allSpans)
  if (grouped.length === 0) return { surviving: [], dropped: [] }

  const codeIds = collectCodeIds(grouped)
  const codedItems = toCodedItems(grouped)
  const { text: presented, mapping } = formatCodedSection(sentences, codedItems, SPAN_STEP_CONTEXT_SENTENCES)
  const messages = buildSpanStepMessages(presented, codeIds, sources, leadingCtx, trailingCtx, resolve, FILTER_CTA)
  const validCodes = [...codeIds]
  const schema = buildFilterSchema(validCodes)
  const errors: string[] = []
  const slots = Array.from({ length: FILTER_RUNS }, (_, i) => i)

  const { results: runs } = await processPool<number, string[]>(
    slots,
    async () => {
      const result = await callAndParse(config.host, FILTER_ENDPOINT, messages, schema, config.calls)
      if (!result.ok) {
        errors.push(result.error)
        return []
      }
      return [mapFilterResults(result.data.results, mapping)]
    },
    noop,
    { concurrency: 3, warmup: 1 }
  )

  if (runs.length < FILTER_RUNS) return { surviving: allSpans, dropped: [] }

  const votes = countKeys(runs)
  const rejected = new Set(
    [...votes.entries()].filter(([, v]) => v >= FILTER_THRESHOLD).map(([k]) => k)
  )

  const surviving: FindResult[] = []
  const dropped: FindResult[] = []
  for (const span of allSpans) {
    const key = spanKey(span.start, span.end, span.analysis_source_id)
    if (rejected.has(key)) {
      dropped.push(span)
    } else {
      surviving.push(span)
    }
  }

  return { surviving, dropped }
}

const runDimensionPipeline = async (
  sources: ScopedSources,
  rawTarget: string,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver,
  config: PipelineConfig
): Promise<DimensionResult> => {
  const { messages: findMessages, sentences } = buildFindCall(rawTarget, sources, resolve, leadingCtx, trailingCtx)
  const validIds = extractSourceIds(sources, resolve)
  const findSchema = buildFindResultSchema(validIds)
  const { runs: findRuns, errors } = await runFindRuns(config.host, findMessages, findSchema, config.calls)

  if (findRuns.length < FIND_RUNS) return { spans: [], errors }

  const tally = tallyVotes(findRuns, sentences.length)
  const spans = filterByTally(tally, FIND_THRESHOLD)

  const titles = buildSourceTitleMap(sources, resolve)
  const perCode = [...tally.entries()].map(([code, votesMap]) => {
    const voted = votesMap.size
    const survived = spans.filter((s) => s.analysis_source_id === code).length
    const name = titles.get(code) ?? code
    return `${name} ${voted}→${survived}`
  })
  console.debug(`[bench] consensus (${FIND_THRESHOLD}/${FIND_RUNS}): ${perCode.join(", ") || "no votes"}`)

  return { spans, errors }
}

const mergeDimensionResults = (results: DimensionResult[]) => {
  const allSpans: FindResult[] = []
  const errors: string[] = []
  for (const dr of results) {
    allSpans.push(...dr.spans)
    errors.push(...dr.errors)
  }
  return { allSpans, errors }
}

const prepareSectionWithContext = (
  content: string,
  startLine: number,
  endLine: number
): { rawSection: string; leadingCtx: string; trailingCtx: string; sentences: string[] } => {
  const rawSection = extractSection(content, startLine, endLine)
  const leadingCtx = prepareTargetContent(extractLeadingContext(content, startLine, CONTEXT_OVERLAP_CHARS))
  const trailingCtx = prepareTargetContent(extractTrailingContext(content, endLine, CONTEXT_OVERLAP_CHARS))
  const section = prepareTargetContent(rawSection)
  const { sentences } = numberSection(section)
  return { rawSection, leadingCtx, trailingCtx, sentences }
}

export interface AnalyzeFileOptions {
  targetContent: string
  sourceFiles: SourceFile[]
  resolve: ContentResolver
  host: string
  calls: CallRecord[]
}

export const analyzeFile = async ({
  targetContent,
  sourceFiles,
  resolve,
  host,
  calls,
}: AnalyzeFileOptions): Promise<SectionResult[]> => {
  const chunks = chunkLines(targetContent, CHUNK_TARGET_CHARS)
  const scoped = partitionSources(sourceFiles)
  const callList = buildCallList(scoped)
  const config: PipelineConfig = { host, calls }
  const sections: SectionResult[] = []

  for (const chunk of chunks) {
    const { rawSection, leadingCtx, trailingCtx, sentences } = prepareSectionWithContext(
      targetContent,
      chunk.startLine,
      chunk.endLine
    )

    if (sentences.length === 0) {
      sections.push({ startLine: chunk.startLine, endLine: chunk.endLine, sentenceCount: 0, results: [] })
      continue
    }

    const dimensionResults = await Promise.all(
      callList.map((sources) => runDimensionPipeline(sources, rawSection, leadingCtx, trailingCtx, resolve, config))
    )

    const { allSpans, errors } = mergeDimensionResults(dimensionResults)

    if (allSpans.length === 0 && callList.length > 0 && errors.length > 0) {
      console.error(`[bench] section ${chunk.startLine}-${chunk.endLine} errors: ${errors.join("; ")}`)
      sections.push({ startLine: chunk.startLine, endLine: chunk.endLine, sentenceCount: sentences.length, results: [] })
      continue
    }

    const { surviving } = await runFilter(allSpans, sentences, scoped, leadingCtx, trailingCtx, resolve, config)
    const reasonResult = await runReasonStep(surviving, sentences, scoped, leadingCtx, trailingCtx, resolve, config)
    const analysisResults = toAnalysisResults(surviving, reasonResult.values)
    const mapped = mapResults(sentences, analysisResults)

    sections.push({
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      sentenceCount: sentences.length,
      results: analysisResults,
    })

    const codeCount = new Set(mapped.map((r) => r.analysis_source_id)).size
    console.debug(`[bench] section ${chunk.startLine}-${chunk.endLine}: ${mapped.length} codings across ${codeCount} codes`)
  }

  return sections
}
