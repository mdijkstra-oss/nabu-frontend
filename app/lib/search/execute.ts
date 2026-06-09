import type { Database, DbError } from "~/lib/db/types"
import type { SearchHit } from "~/domain/search/types"
import type { Result } from "~/lib/fp/result"
import type { FileStore } from "~/lib/files/store"
import type { HybridSearchPlan, KeywordsQuery } from "./semantic"
import type { ScoredChunk } from "./fusion"
import { ok, err } from "~/lib/fp/result"
import { buildCosineQuery, stripOrderByTail, injectSelectColumn } from "./semantic"
import { stripPaging } from "./paging"
import { fuseCosineResults, computeFusedLimit, RRF_K } from "./fusion"
import { queryBm25 } from "./bm25/store"
import { getTotalCorpusChunks } from "./source"
import { yieldToBrowser } from "~/lib/utils/async"

type RawRow = Record<string, unknown>

const hasFileColumn = (row: RawRow): boolean => "file" in row

const toHit = (row: RawRow): SearchHit => ({
  file: String(row.file),
  ...(row.id !== undefined ? { id: String(row.id) } : {}),
  ...(row.text !== undefined ? { text: String(row.text) } : {}),
  ...(row.chunkStart !== undefined ? { chunkStart: Number(row.chunkStart) } : {}),
  ...(row.chunkEnd !== undefined ? { chunkEnd: Number(row.chunkEnd) } : {}),
})

export const executeSearch = async (
  db: Database,
  sql: string
): Promise<Result<SearchHit[], DbError>> => {
  const result = await db.query<RawRow>(sql)
  if (!result.ok) return result

  const rows = result.value.rows
  if (rows.length === 0) return ok([])

  if (!hasFileColumn(rows[0])) {
    return err({ type: "query", message: "Query must SELECT a `file` column" })
  }

  return ok(rows.map(toHit))
}

const COSINE_SCORE_FLOOR = 0.3

const toScoredChunk = (row: RawRow): ScoredChunk => ({
  file: String(row.file),
  text: row.text !== undefined ? String(row.text) : undefined,
  hash: row.hash !== undefined ? String(row.hash) : undefined,
  score: Number(row._semantic_score ?? 0),
  chunkStart: row.chunkStart !== undefined ? Number(row.chunkStart) : undefined,
  chunkEnd: row.chunkEnd !== undefined ? Number(row.chunkEnd) : undefined,
})

const runScoredQuery = async (
  db: Database,
  sql: string
): Promise<Result<ScoredChunk[], DbError>> => {
  const result = await db.query<RawRow>(sql)
  if (!result.ok) return result
  return ok(result.value.rows.map(toScoredChunk).filter((c) => c.score >= COSINE_SCORE_FLOOR))
}

export const chunkToHit = (chunk: ScoredChunk): SearchHit => ({
  file: chunk.file,
  ...(chunk.hash !== undefined ? { hash: chunk.hash } : {}),
  ...(chunk.text !== undefined ? { text: chunk.text } : {}),
  ...(chunk.chunkStart !== undefined ? { chunkStart: chunk.chunkStart } : {}),
  ...(chunk.chunkEnd !== undefined ? { chunkEnd: chunk.chunkEnd } : {}),
  score: chunk.score,
})

type QueryBuilder = (baseSql: string, hyde: HybridSearchPlan["hydes"][number]) => string

const runBm25Query = (
  keywords: KeywordsQuery,
  candidates: Set<string>,
  limit: number
): ScoredChunk[] =>
  queryBm25(keywords.language, keywords.text, limit, { candidates }).map((hit) => ({
    file: hit.file,
    text: hit.text,
    hash: hit.id,
    chunkStart: hit.chunkStart,
    chunkEnd: hit.chunkEnd,
    score: hit.score,
  }))

const buildCandidateQuery = (baseSql: string): string => {
  const core = stripOrderByTail(stripPaging(baseSql))
  return injectSelectColumn(core, "hash")
}

const fetchCandidateHashes = async (
  db: Database,
  baseSql: string
): Promise<Result<Set<string>, DbError>> => {
  const sql = buildCandidateQuery(baseSql)
  const result = await db.query<RawRow>(sql)
  if (!result.ok) return result
  const hashes = new Set<string>()
  for (const row of result.value.rows) {
    if (row.hash !== undefined && row.hash !== null) hashes.add(String(row.hash))
  }
  return ok(hashes)
}

const collectCosineLists = async (
  db: Database,
  plan: HybridSearchPlan,
  buildQuery: QueryBuilder
): Promise<Result<ScoredChunk[][], DbError>> => {
  const results = await Promise.all(
    plan.hydes.map((hyde) => runScoredQuery(db, buildQuery(plan.baseSql, hyde)))
  )

  const cosinePerHyde: ScoredChunk[][] = []
  for (const result of results) {
    if (!result.ok) return result
    cosinePerHyde.push(result.value)
  }

  return ok(cosinePerHyde)
}

const groupCosineByLanguage = (
  plan: HybridSearchPlan,
  cosineLists: ScoredChunk[][]
): Map<string, ScoredChunk[][]> => {
  const grouped = new Map<string, ScoredChunk[][]>()
  for (let i = 0; i < plan.hydes.length; i++) {
    const language = plan.hydes[i].language
    const bucket = grouped.get(language) ?? []
    bucket.push(cosineLists[i])
    grouped.set(language, bucket)
  }
  return grouped
}

const fuseCosinePerLanguage = (
  grouped: Map<string, ScoredChunk[][]>,
  limit: number
): Map<string, ScoredChunk[]> => {
  const out = new Map<string, ScoredChunk[]>()
  for (const [language, lists] of grouped) out.set(language, fuseCosineResults(lists, limit))
  return out
}

const buildBm25PerLanguage = (
  plan: HybridSearchPlan,
  candidates: Set<string>,
  limit: number
): Map<string, ScoredChunk[]> => {
  const out = new Map<string, ScoredChunk[]>()
  for (const kw of plan.keywords) {
    const list = runBm25Query(kw, candidates, limit)
    if (list.length > 0) out.set(kw.language, list)
  }
  return out
}

const EMPTY_BM25 = new Map<string, ScoredChunk[]>()

const topTenChunks = (
  chunks: ScoredChunk[]
): Pick<ScoredChunk, "file" | "hash" | "score" | "text">[] =>
  chunks.slice(0, 10).map((c) => ({ file: c.file, hash: c.hash, score: c.score, text: c.text }))

const logCosineOnlyTopTen = (cosineOnly: ScoredChunk[]): void => {
  console.debug("[search-scoring]", { E: topTenChunks(cosineOnly) })
}

interface ConstituentScores {
  hash: string
  file: string
  language: string
  cosine: number
  bm25: number
  fused: number
  rawCosine: number
}

const computeMaxRawCosineByHash = (cosineLists: ScoredChunk[][]): Map<string, number> => {
  const max = new Map<string, number>()
  for (const list of cosineLists) {
    for (const chunk of list) {
      if (!chunk.hash) continue
      const prev = max.get(chunk.hash) ?? Number.NEGATIVE_INFINITY
      if (chunk.score > prev) max.set(chunk.hash, chunk.score)
    }
  }
  return max
}

const scoreFromRank = (rank: number | undefined): number =>
  rank === undefined ? 0 : 1 / (RRF_K + rank)

const rankByHash = (list: ScoredChunk[]): Map<string, number> => {
  const map = new Map<string, number>()
  for (let i = 0; i < list.length; i++) {
    const hash = list[i].hash
    if (hash && !map.has(hash)) map.set(hash, i + 1)
  }
  return map
}

const fuseAcrossRetrievers = (
  cosineByLang: Map<string, ScoredChunk[]>,
  bm25ByLang: Map<string, ScoredChunk[]>,
  maxRawCosineByHash: Map<string, number>,
  fusedLimit: number,
  planLimit: number | undefined
): { fused: ScoredChunk[]; constituents: ConstituentScores[] } => {
  const languages = new Set([...cosineByLang.keys(), ...bm25ByLang.keys()])
  const merged: ScoredChunk[] = []
  const constituents: ConstituentScores[] = []
  for (const language of languages) {
    const cosine = cosineByLang.get(language) ?? []
    const bm25 = bm25ByLang.get(language) ?? []
    const lists = [cosine, bm25].filter((l) => l.length > 0)
    if (lists.length === 0) continue

    const fusedLang = fuseCosineResults(lists, fusedLimit)
    merged.push(...fusedLang)

    const cosineRanks = rankByHash(cosine)
    const bm25Ranks = rankByHash(bm25)
    for (const chunk of fusedLang) {
      if (!chunk.hash) continue
      constituents.push({
        hash: chunk.hash,
        file: chunk.file,
        language,
        cosine: scoreFromRank(cosineRanks.get(chunk.hash)),
        bm25: scoreFromRank(bm25Ranks.get(chunk.hash)),
        fused: chunk.score,
        rawCosine: maxRawCosineByHash.get(chunk.hash) ?? 0,
      })
    }
  }
  const sorted = merged.sort((a, b) => b.score - a.score)
  const limited = planLimit !== undefined ? sorted.slice(0, planLimit) : sorted
  return { fused: limited, constituents }
}

const logConstituentScores = (constituents: ConstituentScores[]): void => {
  const sorted = [...constituents].sort((a, b) => b.fused - a.fused)
  console.debug(
    "[search] cosine scores:",
    sorted.map((c) => c.cosine)
  )
  console.debug(
    "[search] bm25 scores:",
    sorted.map((c) => c.bm25)
  )
  console.debug(
    "[search] fused scores:",
    sorted.map((c) => c.fused)
  )
  console.debug(
    "[search] raw cosine similarity:",
    sorted.map((c) => c.rawCosine)
  )
}

export const executeHybridLocal = async (
  db: Database,
  plan: HybridSearchPlan,
  files: FileStore
): Promise<Result<SearchHit[], DbError>> => {
  const fusedLimit = computeFusedLimit(getTotalCorpusChunks(files))
  const buildQuery: QueryBuilder = (baseSql, hyde) => buildCosineQuery(baseSql, hyde, fusedLimit)

  const [cosineLists, candidateHashes] = await Promise.all([
    collectCosineLists(db, plan, buildQuery),
    fetchCandidateHashes(db, plan.baseSql),
  ])
  if (!cosineLists.ok) return cosineLists
  if (!candidateHashes.ok) return candidateHashes

  await yieldToBrowser()
  const maxRawCosineByHash = computeMaxRawCosineByHash(cosineLists.value)
  const cosineByLanguage = fuseCosinePerLanguage(
    groupCosineByLanguage(plan, cosineLists.value),
    fusedLimit
  )
  await yieldToBrowser()
  const bm25ByLanguage = buildBm25PerLanguage(plan, candidateHashes.value, fusedLimit)
  await yieldToBrowser()

  const cosineOnlyResult = fuseAcrossRetrievers(
    cosineByLanguage,
    EMPTY_BM25,
    maxRawCosineByHash,
    fusedLimit,
    plan.limit
  )
  const combinedResult = fuseAcrossRetrievers(
    cosineByLanguage,
    bm25ByLanguage,
    maxRawCosineByHash,
    fusedLimit,
    plan.limit
  )
  logCosineOnlyTopTen(cosineOnlyResult.fused)
  logConstituentScores(combinedResult.constituents)

  return ok(combinedResult.fused.map(chunkToHit))
}
