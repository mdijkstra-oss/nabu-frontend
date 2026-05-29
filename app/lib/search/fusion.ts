export interface ScoredChunk {
  file: string
  text?: string
  hash?: string
  score: number
}

export const RRF_K = 60

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

const FUSED_RESULT_LIMIT = 500

export const fuseCosineResults = (
  cosinePerHyde: ScoredChunk[][],
  limit: number | undefined
): ScoredChunk[] => {
  const rankMaps = cosinePerHyde.map(toRankMap)
  const scores = rrfScores(rankMaps)

  const allChunks = cosinePerHyde.flat()
  const chunkLookup = buildChunkLookup(allChunks)

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const cap = limit !== undefined ? limit : FUSED_RESULT_LIMIT
  const sliced = sorted.slice(0, cap)

  return sliced.flatMap(([key, score]) => {
    const chunk = chunkLookup.get(key)
    if (!chunk) return []
    return [{ file: chunk.file, text: chunk.text, hash: chunk.hash, score }]
  })
}
