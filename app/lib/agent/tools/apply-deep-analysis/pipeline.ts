import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { groupBySpan, type CodedSpan } from "./consensus"
import { findAllDimensions, type FindStepResult } from "./step-find"
import { filterAnnotations } from "./step-filter"
import { adjudicateAnnotations } from "./step-adjudicate"
import { reasonAnnotations } from "./step-reason"
import { trimAnnotations } from "./step-trim"
import { POST_FIND_BATCH_SIZE, POST_FIND_CONCURRENCY } from "./def"

export interface PipelineResult {
  annotations: Annotation[]
  errors: string[]
}

const batchItems = <T>(items: T[], size: number): T[][] => {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

const annotationsToCoded = (annotations: Annotation[]): CodedSpan[] =>
  groupBySpan(annotations.map((a) => ({ start: a.start, end: a.end, analysis_source_id: a.code })))

const refineAnnotationBatch = async (
  batch: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<{ annotations: Annotation[]; errors: string[] }> => {
  const errors: string[] = []

  const filterResult = await filterAnnotations(
    batch,
    sentences,
    sources,
    leadingCtx,
    trailingCtx,
    resolve
  )
  errors.push(...filterResult.errors)

  const adjResult = await adjudicateAnnotations(
    filterResult.disputed,
    sentences,
    sources,
    leadingCtx,
    trailingCtx,
    resolve
  )
  errors.push(...adjResult.errors)

  const surviving = [...filterResult.undisputed, ...adjResult.surviving]

  const reasonResult = await reasonAnnotations(
    surviving,
    sentences,
    sources,
    leadingCtx,
    trailingCtx,
    resolve
  )
  if (reasonResult.error) errors.push(reasonResult.error)

  const trimResult = await trimAnnotations(reasonResult.annotations, sentences)
  if (trimResult.error) errors.push(trimResult.error)

  return { annotations: trimResult.annotations, errors }
}

const refineAnnotations = async (
  annotations: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<{ annotations: Annotation[]; errors: string[] }> => {
  const coded = annotationsToCoded(annotations)
  if (coded.length === 0) return { annotations: [], errors: [] }

  const batches = batchItems(coded, POST_FIND_BATCH_SIZE)
  console.debug(`[deep-analysis] post-find: ${coded.length} spans → ${batches.length} batch(es)`)

  const batchAnnotations = batches.map((codedBatch) => {
    const keys = new Set<string>()
    for (const cs of codedBatch) {
      for (const code of cs.codings) keys.add(`${cs.start}-${cs.end}-${code}`)
    }
    return annotations.filter((a) => keys.has(`${a.start}-${a.end}-${a.code}`))
  })

  const { results: batchResults, failures } = await processPool(
    batchAnnotations,
    async (batchAnns) => {
      const result = await refineAnnotationBatch(
        batchAnns,
        sentences,
        sources,
        leadingCtx,
        trailingCtx,
        resolve
      )
      return [result]
    },
    noop,
    { concurrency: POST_FIND_CONCURRENCY }
  )

  const allAnnotations: Annotation[] = []
  const allErrors: string[] = []
  for (const br of batchResults) {
    allAnnotations.push(...br.annotations)
    allErrors.push(...br.errors)
  }
  for (const f of failures) allErrors.push(errorMessage(f.error))

  console.debug(`[deep-analysis] post-find result: ${allAnnotations.length} surviving`)

  return { annotations: allAnnotations, errors: allErrors }
}

export const runAnalysisPipeline = async (
  calls: ScopedSources[],
  rawTarget: string,
  leadingCtx: string,
  trailingCtx: string,
  sources: ScopedSources,
  sentences: string[],
  resolve: ContentResolver
): Promise<PipelineResult> => {
  const findResult: FindStepResult = await findAllDimensions(
    calls,
    rawTarget,
    leadingCtx,
    trailingCtx,
    resolve
  )

  if (findResult.annotations.length === 0) {
    return { annotations: [], errors: findResult.errors }
  }

  const refined = await refineAnnotations(
    findResult.annotations,
    sentences,
    sources,
    leadingCtx,
    trailingCtx,
    resolve
  )

  return {
    annotations: refined.annotations,
    errors: [...findResult.errors, ...refined.errors],
  }
}
