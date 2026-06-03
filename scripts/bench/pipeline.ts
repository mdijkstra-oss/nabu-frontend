import { z } from "zod"
import {
  type ScopedSources,
  type ContentResolver,
  buildFindCall,
  buildFindResultSchema,
  extractSourceIds,
  partitionSources,
  buildCallList,
} from "~/lib/agent/tools/apply-deep-analysis/messages"
import {
  type FindResult,
} from "~/lib/agent/tools/apply-deep-analysis/consensus"
import {
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
  FIND_RUNS,
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

interface VotedSpan {
  span: FindResult
  runIdx: number
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

const voteSpans = (runs: FindResult[][]): { agreed: FindResult[]; disputed: FindResult[] } => {
  const byCode = new Map<string, VotedSpan[]>()
  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    for (const span of runs[runIdx]) {
      const group = byCode.get(span.analysis_source_id) ?? []
      group.push({ span, runIdx })
      byCode.set(span.analysis_source_id, group)
    }
  }

  const agreed: FindResult[] = []
  const disputed: FindResult[] = []

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
            agreed.push({ ...smallest, analysis_source_id: code })
            break
          }
        }
      }
    }

    for (let ri = 0; ri < runs.length; ri++) {
      for (let i = 0; i < perRun[ri].length; i++) {
        if (!matchedSets[ri].has(i)) {
          disputed.push({ ...perRun[ri][i].span, analysis_source_id: code })
        }
      }
    }
  }

  return { agreed, disputed }
}

interface DimensionResult {
  agreed: FindResult[]
  disputed: FindResult[]
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

  if (findRuns.length < FIND_RUNS) return { agreed: [], disputed: [], errors }

  const { agreed, disputed } = voteSpans(findRuns)

  return { agreed, disputed, errors }
}

const mergeDimensionResults = (results: DimensionResult[]) => {
  const allAgreed: FindResult[] = []
  const allDisputed: FindResult[] = []
  const errors: string[] = []
  for (const dr of results) {
    allAgreed.push(...dr.agreed)
    allDisputed.push(...dr.disputed)
    errors.push(...dr.errors)
  }
  return { allAgreed, allDisputed, errors }
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

    const { allAgreed, allDisputed, errors } = mergeDimensionResults(dimensionResults)
    const allSurviving = [...allAgreed, ...allDisputed]

    if (allSurviving.length === 0 && callList.length > 0 && errors.length > 0) {
      console.error(`[bench] section ${chunk.startLine}-${chunk.endLine} errors: ${errors.join("; ")}`)
      sections.push({ startLine: chunk.startLine, endLine: chunk.endLine, sentenceCount: sentences.length, results: [] })
      continue
    }

    const analysisResults = toAnalysisResults(allSurviving, new Map())
    const mapped = mapResults(sentences, analysisResults)

    sections.push({
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      sentenceCount: sentences.length,
      results: analysisResults,
    })

  }

  return sections
}
