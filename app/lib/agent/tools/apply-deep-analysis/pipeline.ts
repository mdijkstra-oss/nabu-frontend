import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { think, REVISITING, FILTERING } from "./thoughts"
import { groupByCode } from "./step-batch"
import { findAllDimensions } from "./step-find"
import { filterAnnotations } from "./step-filter"
import { POST_FIND_CONCURRENCY } from "./def"

export interface PipelineResult {
  annotations: Annotation[]
  errors: string[]
}

interface BatchResult {
  annotations: Annotation[]
  errors: string[]
}

const processBatch = async (
  annotations: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<BatchResult> => {
  think(FILTERING)
  const filterResult = await filterAnnotations(
    annotations,
    sentences,
    sources,
    leadingCtx,
    trailingCtx,
    resolve
  )
  return { annotations: filterResult.surviving, errors: filterResult.errors }
}

export const runAnalysisPipeline = async (
  calls: ScopedSources[],
  rawTarget: string,
  firstFile: string,
  leadingCtx: string,
  trailingCtx: string,
  sources: ScopedSources,
  sentences: string[],
  resolve: ContentResolver
): Promise<PipelineResult> => {
  const findResult = await findAllDimensions(
    calls,
    rawTarget,
    firstFile,
    leadingCtx,
    trailingCtx,
    resolve
  )

  if (findResult.annotations.length === 0) {
    return { annotations: [], errors: findResult.errors }
  }

  const batches = groupByCode(findResult.annotations)

  console.debug(`[deep-analysis] batches: ${batches.length}`)

  think(REVISITING)
  const { results: batchResults, failures } = await processPool(
    batches,
    async (batch) => [
      await processBatch(batch, sentences, sources, leadingCtx, trailingCtx, resolve),
    ],
    noop,
    { concurrency: POST_FIND_CONCURRENCY }
  )

  const surviving: Annotation[] = []
  const allErrors = [...findResult.errors]
  for (const br of batchResults) {
    surviving.push(...br.annotations)
    allErrors.push(...br.errors)
  }
  for (const f of failures) allErrors.push(errorMessage(f.error))

  console.debug(
    `[deep-analysis] post-pipeline: ${surviving.length} surviving from ${findResult.annotations.length} found`
  )

  return { annotations: surviving, errors: allErrors }
}
