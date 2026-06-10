import { isDebugOn } from "~/lib/debug/options"

export interface ScoredChunk {
  file: string
  text?: string
  hash?: string
  score: number
  chunkStart?: number
  chunkEnd?: number
}

export const RRF_K = 60

export const SEARCH_PAGE_SIZE = 30

const FUSED_LIMIT_FLOOR = 1000
const FUSED_LIMIT_RATIO = 0.2

export const computeFusedLimit = (corpusChunks: number): number =>
  isDebugOn("embeddingsLimitOnePage")
    ? SEARCH_PAGE_SIZE
    : Math.max(FUSED_LIMIT_FLOOR, Math.ceil(corpusChunks * FUSED_LIMIT_RATIO))

export const chunkKey = (row: ScoredChunk): string => row.hash ?? `${row.file}:${row.text}`

const buildChunkLookup = (chunks: ScoredChunk[]): Map<string, ScoredChunk> => {
  const lookup = new Map<string, ScoredChunk>()
  for (const chunk of chunks) {
    lookup.set(chunkKey(chunk), chunk)
  }
  return lookup
}

export const toRankMap = (rows: ScoredChunk[]): Map<string, number> => {
  const map = new Map<string, number>()
  for (let i = 0; i < rows.length; i++) {
    const key = chunkKey(rows[i])
    if (!map.has(key)) map.set(key, i + 1)
  }
  return map
}

export const rrfScores = (rankMaps: Map<string, number>[], k = RRF_K): Map<string, number> => {
  const scores = new Map<string, number>()

  for (const rankMap of rankMaps) {
    for (const [key, rank] of rankMap) {
      const contribution = 1 / (k + rank)
      scores.set(key, (scores.get(key) ?? 0) + contribution)
    }
  }

  return scores
}

export const fuseCosineResults = (cosinePerHyde: ScoredChunk[][], limit: number): ScoredChunk[] => {
  const rankMaps = cosinePerHyde.map(toRankMap)
  const scores = rrfScores(rankMaps)

  const allChunks = cosinePerHyde.flat()
  const chunkLookup = buildChunkLookup(allChunks)

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const sliced = sorted.slice(0, limit)

  return sliced.flatMap(([key, score]) => {
    const chunk = chunkLookup.get(key)
    if (!chunk) return []
    return [
      {
        file: chunk.file,
        text: chunk.text,
        hash: chunk.hash,
        chunkStart: chunk.chunkStart,
        chunkEnd: chunk.chunkEnd,
        score,
      },
    ]
  })
}
