import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { Chunk } from "~/lib/embeddings/chunk"
import type { NumberedEntry } from "~/lib/agent/tools/scout-filter/messages"
import { chunkText } from "~/lib/embeddings/chunk"
import { filterEntries } from "~/lib/agent/tools/scout-filter/api"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"

const SCOUT_CONCURRENCY = 10

export interface ChunkBlock {
  id: number
  chunkStart: number
  text: string
}

const trimEnd = (chunks: Chunk[], i: number, contentLen: number): number =>
  i < chunks.length - 1 ? chunks[i + 1].chunkStart : Math.max(chunks[i].chunkEnd, contentLen)

export const buildChunkBlocks = (content: string, chunks: Chunk[]): ChunkBlock[] =>
  chunks.map((c, i) => ({
    id: i + 1,
    chunkStart: c.chunkStart,
    text: content.slice(c.chunkStart, trimEnd(chunks, i, content.length)),
  }))

const toEntries = (blocks: ChunkBlock[]): NumberedEntry[] =>
  blocks.map((b) => ({ index: b.id, text: b.text }))

const excludedChunkStarts = (blocks: ChunkBlock[], excludedIds: Set<number>): Set<number> => {
  const out = new Set<number>()
  for (const b of blocks) if (excludedIds.has(b.id)) out.add(b.chunkStart)
  return out
}

const scoutFileExcludes = async (
  file: string,
  framework: string,
  files: FileStore
): Promise<Set<number>> => {
  const content = files[file]
  if (content === undefined) return new Set()

  const chunks = chunkText(content)
  if (chunks.length === 0) return new Set()

  const blocks = buildChunkBlocks(content, chunks)
  const excludedIds = await filterEntries(framework, toEntries(blocks))
  return excludedChunkStarts(blocks, excludedIds)
}

const uniqueFiles = (batch: SearchHit[]): string[] => [...new Set(batch.map((h) => h.file))]

const buildExcludeMap = async (
  files: FileStore,
  framework: string,
  filesInBatch: string[]
): Promise<Map<string, Set<number>>> => {
  const map = new Map<string, Set<number>>()
  await processPool(
    filesInBatch,
    async (file) => {
      const excludes = await scoutFileExcludes(file, framework, files)
      map.set(file, excludes)
      return []
    },
    noop,
    { concurrency: SCOUT_CONCURRENCY }
  )
  return map
}

const isExcluded = (hit: SearchHit, excludes: Map<string, Set<number>>): boolean => {
  if (hit.chunkStart === undefined) return false
  const fileExcludes = excludes.get(hit.file)
  if (!fileExcludes) return false
  return fileExcludes.has(hit.chunkStart)
}

export const scoutFilterBatch = async (
  batch: SearchHit[],
  framework: string,
  files: FileStore
): Promise<SearchHit[]> => {
  if (framework.length === 0 || batch.length === 0) return batch

  const excludes = await buildExcludeMap(files, framework, uniqueFiles(batch))
  return batch.filter((h) => !isExcluded(h, excludes))
}
