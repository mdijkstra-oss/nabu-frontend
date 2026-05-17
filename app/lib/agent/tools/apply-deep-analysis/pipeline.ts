import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { readDebugOption } from "~/lib/agent/debug"
import { think, REVISITING, FILTERING, ADJUDICATING, GROUNDING, TRIMMING } from "./thoughts"
import { batchByCode, BATCH_MAX_SIZE } from "./step-batch"
import { findAllDimensions, type FindStepResult } from "./step-find"
import { filterAnnotations } from "./step-filter"
import { adjudicateAnnotations } from "./step-adjudicate"
import { reasonAnnotations } from "./step-reason"
import { trimAnnotations } from "./step-trim"
import { POST_FIND_CONCURRENCY } from "./def"

export interface PipelineResult {
  annotations: Annotation[]
  errors: string[]
}

const refineAnnotationBatch = async (
  batch: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<{ annotations: Annotation[]; errors: string[] }> => {
  const errors: string[] = []

  think(FILTERING)
  const filterResult = await filterAnnotations(
    batch,
    sentences,
    sources,
    leadingCtx,
    trailingCtx,
    resolve
  )
  errors.push(...filterResult.errors)

  think(ADJUDICATING)
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

  think(GROUNDING)
  const reasonResult = await reasonAnnotations(
    surviving,
    sentences,
    sources,
    leadingCtx,
    trailingCtx,
    resolve
  )
  if (reasonResult.error) errors.push(reasonResult.error)

  think(TRIMMING)
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
  think(REVISITING)
  if (annotations.length === 0) return { annotations: [], errors: [] }

  const batchAnnotations = batchByCode(annotations, BATCH_MAX_SIZE)
  console.debug(
    `[deep-analysis] post-find: ${annotations.length} annotations → ${batchAnnotations.length} batch(es)`
  )

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

const isFindOnly = (): boolean => readDebugOption("findOnly", false)

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

  if (findResult.annotations.length === 0 || isFindOnly()) {
    return { annotations: findResult.annotations, errors: findResult.errors }
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
