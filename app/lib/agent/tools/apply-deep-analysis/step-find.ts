import type { Annotation } from "./types"
import type { ScopedSources } from "./messages"
import type { SemanticContextBase } from "~/domain/corpus/init"
import type { FileStore } from "~/lib/files/store"
import type { Composite } from "~/lib/composite/pack"
import type { SearchHit } from "~/domain/search/types"
import { chunkText } from "~/lib/embeddings/chunk"
import { lineToCharOffset } from "~/lib/text/lines"
import { getCallouts } from "~/domain/data-blocks/callout/selectors"
import { runSearchPipeline } from "~/lib/search/pipeline"
import { locateTextInSentences } from "~/lib/text/present"
import { spanKey } from "./format"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { BRANCH_CONCURRENCY, PER_DIM_TARGET } from "./def"

export interface RangeInFile {
  startLine: number
  endLine: number
}

export interface FileHashPair {
  file: string
  hash: string
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

const buildHighlight = (rawDimFile: string): string => {
  const callouts = getCallouts(rawDimFile)
  if (callouts.length === 0) return ""
  const c = callouts[0]
  return [c.title, c.content].filter(Boolean).join("\n")
}

export const mapHitToAnnotations = (
  hit: SearchHit,
  dim: string,
  compositeSentences: string[]
): Annotation[] => {
  const matches = hit.matches ?? []
  const out: Annotation[] = []
  for (const text of matches) {
    if (!text) continue
    const located = locateTextInSentences(compositeSentences, text)
    if (!located) continue
    out.push({
      start: located.start,
      end: located.end,
      code: dim,
      reason: "",
      findVotes: [],
      score: hit.score,
    })
  }
  return out
}

export const dedupBySpan = (annotations: Annotation[]): Annotation[] => {
  const seen = new Set<string>()
  const out: Annotation[] = []
  for (const a of annotations) {
    const key = spanKey(a.start, a.end, a.code)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

const collectRangesByFile = (composite: Composite): Map<string, RangeInFile[]> => {
  const byFile = new Map<string, RangeInFile[]>()
  for (const seg of composite.segments) {
    const list = byFile.get(seg.path) ?? []
    list.push({ startLine: seg.startLine, endLine: seg.endLine })
    byFile.set(seg.path, list)
  }
  return byFile
}

const collectPairs = (
  composite: Composite,
  resolveFile: (path: string) => string | undefined
): FileHashPair[] => {
  const byFile = collectRangesByFile(composite)
  const pairs: FileHashPair[] = []
  for (const [file, ranges] of byFile) {
    const rawFile = resolveFile(file)
    if (!rawFile) continue
    const hashes = chunkHashesForRanges(rawFile, ranges)
    for (const hash of hashes) pairs.push({ file, hash })
  }
  return pairs
}

export interface SearchCtx {
  ctx: SemanticContextBase
  files: FileStore
  framework: string
  resolveFile: (path: string) => string | undefined
}

interface Branch {
  dimPath: string
  pairs: FileHashPair[]
}

const runBranch = async (
  branch: Branch,
  search: SearchCtx,
  compositeSentences: string[]
): Promise<Annotation[]> => {
  const rawDim = search.resolveFile(branch.dimPath)
  if (!rawDim) return []

  const highlight = buildHighlight(rawDim)
  if (!highlight) return []

  const sql = buildCandidateSql(branch.dimPath, branch.pairs)
  const result = await runSearchPipeline(
    sql,
    highlight,
    search.ctx,
    search.files,
    PER_DIM_TARGET,
    search.framework
  )
  if (!result.ok) {
    console.warn(
      `[apply-deep find] search failed for dim ${branch.dimPath}: ${result.error.message}`
    )
    return []
  }

  const collected: Annotation[] = []
  for (const hit of result.value.hits) {
    collected.push(...mapHitToAnnotations(hit, branch.dimPath, compositeSentences))
  }
  return collected
}

export const runFind = async (
  composite: Composite,
  expanded: ScopedSources,
  compositeSentences: string[],
  search: SearchCtx
): Promise<Annotation[]> => {
  if (expanded.dimension.length === 0) return []
  const pairs = collectPairs(composite, search.resolveFile)
  if (pairs.length === 0) return []

  const branches: Branch[] = expanded.dimension.map((dimPath) => ({ dimPath, pairs }))

  const pool = await processPool<Branch, Annotation>(
    branches,
    (branch) => runBranch(branch, search, compositeSentences),
    noop,
    { concurrency: BRANCH_CONCURRENCY }
  )

  return dedupBySpan(pool.results)
}
