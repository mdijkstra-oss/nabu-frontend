import type { Chunk } from "./chunk"

export interface EmbeddingEntry {
  hash: string
  text: string
  embedding: number[]
  chunkStart: number
  chunkEnd: number
  language?: string
}

export interface DiffResult {
  keep: EmbeddingEntry[]
  needed: Chunk[]
}

// WHY the width is part of the diff: an entry at another width is not stale, it
// is incomparable — cosine against it returns a number rather than an error. A
// hash hit at the wrong width is therefore a miss, which puts the chunk back in
// `needed` and rewrites the companion at the current width.
export const diffChunks = (
  existing: EmbeddingEntry[],
  current: Chunk[],
  dimensions: number
): DiffResult => {
  const existingByHash = new Map(
    existing.filter((e) => e.embedding.length === dimensions).map((e) => [e.hash, e])
  )

  const keep: EmbeddingEntry[] = []
  const needed: Chunk[] = []

  for (const chunk of current) {
    const entry = existingByHash.get(chunk.hash)
    if (entry) {
      keep.push({ ...entry, chunkStart: chunk.chunkStart, chunkEnd: chunk.chunkEnd })
    } else {
      needed.push(chunk)
    }
  }

  return { keep, needed }
}
