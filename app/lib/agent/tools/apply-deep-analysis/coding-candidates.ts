import type { SemanticContextBase } from "~/domain/corpus/init"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { Result } from "~/lib/fp/result"
import { verdict } from "~/lib/search/verdict"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { stripGeneratedSuffix } from "~/lib/files/filename"
import { BRANCH_CONCURRENCY } from "./def"
import type { CodingChunk } from "./coding-chunk"
import { withScore } from "./coding-chunk"
import type { CodingCandidate } from "./step-code"
import type { ContentResolver } from "./messages"

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
  const pool = await processPool<{ dimensionPath: string }, CandidateStageResult>(
    branches,
    async ({ dimensionPath }) => {
      const rawDimension = search.resolveFile(dimensionPath)
      if (!rawDimension)
        return [{ candidates: [], errors: [`dimension file unavailable: ${dimensionPath}`] }]
      const result = await retrieve(
        buildCandidateSql(dimensionPath, chunks),
        search.ctx,
        search.files
      )
      if (!result.ok)
        return [
          {
            candidates: [],
            errors: [`retrieval failed for dimension ${dimensionPath}: ${result.error.message}`],
          },
        ]
      const code = stripGeneratedSuffix(dimensionPath)
      const candidates = chunks.flatMap<CodingCandidate>((chunk) => {
        const hit = result.value.find((candidate) => chunkMatchesHit(chunk, candidate))
        return hit ? [{ code, dimensionPath, chunk: withScore(chunk, hit.score) }] : []
      })
      return [{ candidates, errors: [] }]
    },
    noop,
    { concurrency: BRANCH_CONCURRENCY }
  )

  const candidates = pool.results.flatMap((result) => result.candidates)
  const errors = pool.results.flatMap((result) => result.errors)
  for (const failure of pool.failures) errors.push(errorMessage(failure.error))
  return { candidates, errors }
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
  files: FileStore,
  resolve: ContentResolver,
  runVerdict: typeof verdict = verdict
): Promise<CandidateStageResult> => {
  const byDimension = new Map<string, CodingCandidate[]>()
  for (const candidate of candidates) {
    const group = byDimension.get(candidate.dimensionPath) ?? []
    group.push(candidate)
    byDimension.set(candidate.dimensionPath, group)
  }

  const pool = await processPool<[string, CodingCandidate[]], CandidateStageResult>(
    [...byDimension],
    async ([dimensionPath, group]) => {
      const intent = resolve(dimensionPath)
      if (!intent)
        return [{ candidates: [], errors: [`dimension file unavailable: ${dimensionPath}`] }]
      const hits: SearchHit[] = group.map((candidate) => ({
        id: `${candidate.code}\0${candidate.chunk.id}`,
        file: candidate.chunk.file,
        hash: candidate.chunk.hash,
        text: candidate.chunk.text,
        chunkStart: candidate.chunk.chunkStart,
        chunkEnd: candidate.chunk.chunkEnd,
        score: candidate.chunk.score,
      }))
      const result = await runVerdict(hits, intent, "", files, noop)
      const errors = result.failures.map((failure) => errorMessage(failure.error))
      if (result.rawRemaining.length > 0)
        errors.push(`${result.rawRemaining.length} semantic-filter candidate(s) were not processed`)
      if (errors.length > 0) return [{ candidates: [], errors }]
      const kept = new Set(result.results.map((hit) => hit.id))
      return [
        {
          candidates: group.filter((candidate) =>
            kept.has(`${candidate.code}\0${candidate.chunk.id}`)
          ),
          errors: [],
        },
      ]
    },
    noop,
    { concurrency: BRANCH_CONCURRENCY }
  )

  const kept = pool.results.flatMap((result) => result.candidates)
  const errors = pool.results.flatMap((result) => result.errors)
  for (const failure of pool.failures) errors.push(errorMessage(failure.error))
  return { candidates: kept, errors }
}
