import type { SemanticContextBase } from "~/domain/corpus/init"
import type { FileStore } from "~/lib/files/store"
import type { SearchHit } from "~/domain/search/types"
import type { Target } from "./def"
import type { Envelope } from "./envelope"
import { chunkText } from "~/lib/embeddings/chunk"
import { lineToCharOffset } from "~/lib/text/lines"
import { runSearchPipeline } from "~/lib/search/pipeline"
import { findMatchOffset } from "~/lib/text/find"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { BRANCH_CONCURRENCY, PER_DIM_TARGET, SPAN_STEP_CONTEXT_SENTENCES } from "./def"
import { stripGeneratedSuffix } from "~/lib/files/filename"
import type { Tracer } from "./trace"
import { indexFileSentences, buildHaloForRows, type SentenceRow } from "~/lib/text/halo"

export interface RangeInFile {
  startLine: number
  endLine: number
}

export interface FileHashPair {
  file: string
  hash: string
}

export interface SearchCtx {
  ctx: SemanticContextBase
  files: FileStore
  framework: string
  resolveFile: (path: string) => string | undefined
}

const escapeSqlString = (s: string): string => s.replace(/'/g, "''")

export const chunkHashesForRanges = (rawFile: string, ranges: RangeInFile[]): string[] => {
  if (ranges.length === 0 || rawFile.length === 0) return []
  const chunks = chunkText(rawFile)
  if (chunks.length === 0) return []
  const spans = ranges.map((r) => ({
    start: lineToCharOffset(rawFile, r.startLine - 1),
    end: lineToCharOffset(rawFile, r.endLine),
  }))
  return chunks
    .filter((c) => spans.some((s) => c.chunkStart < s.end && c.chunkEnd > s.start))
    .map((c) => c.hash)
}

const groupHashesByFile = (pairs: FileHashPair[]): Map<string, string[]> => {
  const byFile = new Map<string, string[]>()
  for (const { file, hash } of pairs) {
    const list = byFile.get(file) ?? []
    list.push(hash)
    byFile.set(file, list)
  }
  return byFile
}

const renderFileClause = (file: string, hashes: string[]): string => {
  const hashList = hashes.map((h) => `'${escapeSqlString(h)}'`).join(", ")
  return `(f.file = '${escapeSqlString(file)}' AND hash IN (${hashList}))`
}

export const buildCandidateSql = (dimPath: string, pairs: FileHashPair[]): string => {
  const byFile = groupHashesByFile(pairs)
  const clauses = [...byFile].map(([file, hashes]) => renderFileClause(file, hashes))
  return [
    `SELECT f.file, f.text, EMBEDDINGS_FROM_FILE('${escapeSqlString(dimPath)}')`,
    `FROM files f`,
    `WHERE ${clauses.join(" OR ")}`,
  ].join(" ")
}

const collectRangesByTarget = (targets: readonly Target[]): Map<string, RangeInFile[]> => {
  const byFile = new Map<string, RangeInFile[]>()
  for (const t of targets) {
    const list = byFile.get(t.path) ?? []
    list.push({
      startLine: t.start_line ?? 1,
      endLine: t.end_line ?? Number.MAX_SAFE_INTEGER,
    })
    byFile.set(t.path, list)
  }
  return byFile
}

const collectPairsFromTargets = (
  targets: readonly Target[],
  resolveFile: (path: string) => string | undefined
): FileHashPair[] => {
  const byFile = collectRangesByTarget(targets)
  const pairs: FileHashPair[] = []
  for (const [file, ranges] of byFile) {
    const rawFile = resolveFile(file)
    if (!rawFile) continue
    const clampedRanges = ranges.map((r) => ({
      startLine: r.startLine,
      endLine: Math.min(r.endLine, rawFile.split("\n").length),
    }))
    const hashes = chunkHashesForRanges(rawFile, clampedRanges)
    for (const hash of hashes) pairs.push({ file, hash })
  }
  return pairs
}

export const uniqueFilesFromPairs = (pairs: readonly FileHashPair[]): string[] => [
  ...new Set(pairs.map((p) => p.file)),
]

interface Branch {
  dimPath: string
  pairs: FileHashPair[]
}

interface FileIndex {
  rows: SentenceRow[]
}

const buildFileIndex = (rawFile: string): FileIndex => ({
  rows: indexFileSentences(rawFile),
})

let envCounter = 0
const nextEnvelopeId = (): string => `env-${++envCounter}`

const envelopeFromMatch = (
  hit: SearchHit,
  matchText: string,
  code: string,
  fileIndex: FileIndex
): Envelope | null => {
  const prose = fileIndex.rows.map((r) => r.text).join(" ")
  const offset = findMatchOffset(prose, matchText)
  if (!offset) return null
  let charStart = 0
  let charEnd = 0
  for (const r of fileIndex.rows) {
    if (r.start <= offset.start && offset.start < r.end) charStart = r.start
    if (r.start < offset.end && offset.end <= r.end) charEnd = r.end
  }

  const halo = buildHaloForRows(
    fileIndex.rows,
    charStart || offset.start,
    charEnd || offset.end,
    SPAN_STEP_CONTEXT_SENTENCES
  )
  if (!halo) return null

  return {
    id: nextEnvelopeId(),
    code,
    file: hit.file,
    fileCharStart: halo.fileCharStart,
    fileCharEnd: halo.fileCharEnd,
    haloSentences: halo.haloSentences,
    markedStart: halo.markedStart,
    markedEnd: halo.markedEnd,
    markedText: matchText,
    score: hit.score,
    findVotes: [],
  }
}

const runBranch = async (
  branch: Branch,
  search: SearchCtx,
  tracer?: Tracer
): Promise<Envelope[]> => {
  const code = stripGeneratedSuffix(branch.dimPath)
  const files = uniqueFilesFromPairs(branch.pairs)
  const rawDim = search.resolveFile(branch.dimPath)
  if (!rawDim) {
    tracer?.setFind(code, { candidates: 0, files, limit: PER_DIM_TARGET, title: branch.dimPath })
    return []
  }

  const sql = buildCandidateSql(branch.dimPath, branch.pairs)
  const result = await runSearchPipeline(
    sql,
    rawDim,
    search.ctx,
    search.files,
    PER_DIM_TARGET,
    search.framework
  )
  if (!result.ok) {
    console.warn(
      `[apply-deep find] search failed for dim ${branch.dimPath}: ${result.error.message}`
    )
    tracer?.setFind(code, { candidates: 0, files, limit: PER_DIM_TARGET, title: branch.dimPath })
    return []
  }

  tracer?.setFind(code, {
    candidates: result.value.hits.length,
    files,
    limit: PER_DIM_TARGET,
    title: branch.dimPath,
  })

  const fileIndexCache = new Map<string, FileIndex>()
  const envelopes: Envelope[] = []
  for (const hit of result.value.hits) {
    const rawFile = search.resolveFile(hit.file)
    if (!rawFile) continue
    let idx = fileIndexCache.get(hit.file)
    if (!idx) {
      idx = buildFileIndex(rawFile)
      fileIndexCache.set(hit.file, idx)
    }
    for (const matchText of hit.matches ?? []) {
      if (!matchText) continue
      const env = envelopeFromMatch(hit, matchText, code, idx)
      if (env) envelopes.push(env)
    }
  }
  return envelopes
}

const dedupBySpan = (envelopes: Envelope[]): Envelope[] => {
  const seen = new Set<string>()
  const out: Envelope[] = []
  for (const e of envelopes) {
    const key = `${e.file}:${e.fileCharStart}-${e.fileCharEnd}:${e.code}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

export const runFind = async (
  targets: readonly Target[],
  dimensionPaths: readonly string[],
  search: SearchCtx,
  tracer?: Tracer
): Promise<Envelope[]> => {
  if (dimensionPaths.length === 0) return []
  const pairs = collectPairsFromTargets(targets, search.resolveFile)
  if (pairs.length === 0) return []

  const branches: Branch[] = dimensionPaths.map((dimPath) => ({ dimPath, pairs }))

  const pool = await processPool<Branch, Envelope>(
    branches,
    (branch) => runBranch(branch, search, tracer),
    noop,
    { concurrency: BRANCH_CONCURRENCY }
  )

  return dedupBySpan(pool.results)
}
