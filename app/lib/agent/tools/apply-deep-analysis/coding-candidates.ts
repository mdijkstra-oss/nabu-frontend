import type { SemanticContextBase } from "~/domain/corpus/init"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { Result } from "~/lib/fp/result"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { stripGeneratedSuffix } from "~/lib/files/filename"
import { BRANCH_CONCURRENCY, POST_FIND_CONCURRENCY, SEMANTIC_GATE_ENDPOINT } from "./def"
import type { CodingChunk } from "./coding-chunk"
import { withScore } from "./coding-chunk"
import {
  batchCodeIds,
  codingEntry,
  groupCodingCandidates,
  packCodingChunks,
  type CodingCandidate,
  type CodingChunkCandidates,
} from "./step-code"
import {
  buildAnalysisCallShape,
  SEMANTIC_GATE_CTA,
  SemanticGateSchema,
  type ContentResolver,
  type ParseCall,
  type ScopedSources,
} from "./messages"
import { callAndParse } from "../../client/call-parse"
import { assignIds, buildEntryMessages } from "~/lib/calls/entry"

export interface CodingSearchCtx {
  ctx: SemanticContextBase
  files: FileStore
  framework: string
  resolveFile: (path: string) => string | undefined
}

export interface CandidateStageResult {
  candidates: CodingCandidate[]
  errors: string[]
}

interface RetrievalBranchResult {
  matched: CodingChunk[]
  errors: string[]
}

interface SemanticGateBatchResult {
  keptChunkIds: string[]
  errors: string[]
}

export type RetrievalCall = (
  sql: string,
  ctx: SemanticContextBase,
  files: FileStore
) => Promise<Result<SearchHit[], { message: string }>>

const defaultRetrieve: RetrievalCall = async (sql, ctx, files) => {
  const { runRetrievalPipeline } = await import("~/lib/search/pipeline")
  return runRetrievalPipeline(sql, ctx, files)
}

const escapeSqlString = (value: string): string => value.replace(/'/g, "''")

const buildCandidateSql = (dimensionPath: string, chunks: readonly CodingChunk[]): string => {
  const byFile = new Map<string, string[]>()
  for (const chunk of chunks) {
    const hashes = byFile.get(chunk.file) ?? []
    hashes.push(chunk.hash)
    byFile.set(chunk.file, hashes)
  }
  const clauses = [...byFile].map(([file, hashes]) => {
    const hashList = hashes.map((hash) => `'${escapeSqlString(hash)}'`).join(", ")
    return `(f.file = '${escapeSqlString(file)}' AND hash IN (${hashList}))`
  })
  return [
    `SELECT f.file, f.text, EMBEDDINGS_FROM_FILE('${escapeSqlString(dimensionPath)}')`,
    "FROM files f",
    `WHERE ${clauses.join(" OR ")}`,
  ].join(" ")
}

const chunkMatchesHit = (chunk: CodingChunk, hit: SearchHit): boolean => {
  if (chunk.file !== hit.file) return false
  if (hit.hash === chunk.hash || hit.constituentHashes?.includes(chunk.hash)) return true
  if (hit.chunkStart === undefined || hit.chunkEnd === undefined) return false
  return chunk.chunkStart < hit.chunkEnd && hit.chunkStart < chunk.chunkEnd
}

export const retrieveCodingCandidates = async (
  chunks: readonly CodingChunk[],
  dimensionPaths: readonly string[],
  search: CodingSearchCtx,
  retrieve: RetrievalCall = defaultRetrieve
): Promise<CandidateStageResult> => {
  if (chunks.length === 0) return { candidates: [], errors: [] }
  const branches = dimensionPaths.map((dimensionPath) => ({ dimensionPath }))
  const pool = await processPool<{ dimensionPath: string }, RetrievalBranchResult>(
    branches,
    async ({ dimensionPath }) => {
      const rawDimension = search.resolveFile(dimensionPath)
      if (!rawDimension)
        return [{ matched: [], errors: [`dimension file unavailable: ${dimensionPath}`] }]
      const result = await retrieve(
        buildCandidateSql(dimensionPath, chunks),
        search.ctx,
        search.files
      )
      if (!result.ok)
        return [
          {
            matched: [],
            errors: [`retrieval failed for dimension ${dimensionPath}: ${result.error.message}`],
          },
        ]
      const matched = chunks.flatMap((chunk) => {
        const hit = result.value.find((candidate) => chunkMatchesHit(chunk, candidate))
        return hit ? [withScore(chunk, hit.score)] : []
      })
      return [{ matched, errors: [] }]
    },
    noop,
    { concurrency: BRANCH_CONCURRENCY }
  )

  const errors = pool.results.flatMap((result) => result.errors)
  for (const failure of pool.failures) errors.push(errorMessage(failure.error))

  // A chunk any dimension retrieved is offered to every code; branches only
  // decide membership, so all that survives them is the best score seen.
  const scores = new Map<string, number | undefined>()
  for (const chunk of pool.results.flatMap((result) => result.matched)) {
    const current = scores.get(chunk.id)
    if (current === undefined || (chunk.score !== undefined && chunk.score > current))
      scores.set(chunk.id, chunk.score)
  }
  const matchedChunks = chunks.flatMap((chunk) =>
    scores.has(chunk.id) ? [withScore(chunk, scores.get(chunk.id))] : []
  )
  return { candidates: passthroughCodingCandidates(matchedChunks, dimensionPaths), errors }
}

export const passthroughCodingCandidates = (
  chunks: readonly CodingChunk[],
  dimensionPaths: readonly string[]
): CodingCandidate[] =>
  dimensionPaths.flatMap((dimensionPath) => {
    const code = stripGeneratedSuffix(dimensionPath)
    return chunks.map((chunk) => ({ code, dimensionPath, chunk }))
  })

export const semanticGateCodingCandidates = async (
  candidates: readonly CodingCandidate[],
  sources: ScopedSources,
  resolve: ContentResolver,
  parse: ParseCall = callAndParse
): Promise<CandidateStageResult> => {
  const groups = groupCodingCandidates(candidates)
  if (groups.length === 0) return { candidates: [], errors: [] }
  const chunkBatches = packCodingChunks(groups)
  const batches = batchCodeIds(candidates.map((candidate) => candidate.code)).flatMap((codes) =>
    chunkBatches.map((groups) => ({ codes, groups }))
  )
  const pool = await processPool<
    { codes: ReadonlySet<string>; groups: CodingChunkCandidates[] },
    SemanticGateBatchResult
  >(
    batches,
    async ({ codes, groups }) => {
      const entries = assignIds(groups.map(codingEntry))
      const result = await parse(
        SEMANTIC_GATE_ENDPOINT,
        buildEntryMessages(
          buildAnalysisCallShape(codes, sources, resolve, SEMANTIC_GATE_CTA),
          entries
        ),
        SemanticGateSchema
      )
      if (!result.ok)
        return [{ keptChunkIds: [], errors: [`${SEMANTIC_GATE_ENDPOINT}: ${result.error}`] }]
      const kept = new Set(result.data.results.map(({ id }) => id))
      return [
        {
          keptChunkIds: entries.flatMap((entry) =>
            kept.has(entry.id) ? [entry.item.chunk.id] : []
          ),
          errors: [],
        },
      ]
    },
    noop,
    { concurrency: POST_FIND_CONCURRENCY }
  )

  const keptChunkIds = new Set(pool.results.flatMap((result) => result.keptChunkIds))
  const kept = groups.flatMap((group) => (keptChunkIds.has(group.chunk.id) ? group.candidates : []))
  const errors = pool.results.flatMap((result) => result.errors)
  for (const failure of pool.failures) errors.push(errorMessage(failure.error))
  return { candidates: kept, errors }
}
