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

export const diffChunks = (existing: EmbeddingEntry[], current: Chunk[]): DiffResult => {
  const existingByHash = new Map(existing.map((e) => [e.hash, e]))

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
