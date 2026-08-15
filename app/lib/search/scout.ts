import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { Chunk } from "~/lib/embeddings/chunk"
import { chunkFileForEmbedding } from "~/lib/embeddings/chunk"
import { callAndParse } from "~/lib/agent/client/call-parse"
import { assignIds, entrySize, type EntryInput } from "~/lib/calls/entry"
import { pack } from "~/lib/calls/pack"
import { getEmbeddableSource } from "./source"
import { filterEntries } from "~/lib/agent/tools/scout-filter/api"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"

export interface ChunkBlock {
  chunkStart: number
  text: string
}

export const buildChunkBlocks = (content: string, chunks: Chunk[]): ChunkBlock[] =>
  chunks.map((c, i) => ({
    chunkStart: c.chunkStart,
    text: content.slice(c.chunkStart, trimEnd(chunks, i, content.length)),
  }))

export const scoutFilterBatch = async (
  batch: SearchHit[],
  framework: string,
  files: FileStore,
  parse: typeof callAndParse = callAndParse
): Promise<SearchHit[]> => {
  if (framework.length === 0 || batch.length === 0) return batch

  const excludes = await buildExcludeMap(files, framework, uniqueFiles(batch), parse)
  return batch.filter((h) => !isExcluded(h, excludes))
}

const SCOUT_CONCURRENCY = 5
const SCOUT_MAX_CHARS = 100_000

const trimEnd = (chunks: Chunk[], i: number, contentLen: number): number =>
  i < chunks.length - 1 ? chunks[i + 1].chunkStart : Math.max(chunks[i].chunkEnd, contentLen)

export const toEntryInput = (file: string, block: ChunkBlock): EntryInput<ChunkBlock> => ({
  item: block,
  file,
  content: { plain: [block.text] },
})

const excludedInCall = async (
  framework: string,
  inputs: EntryInput<ChunkBlock>[],
  parse: typeof callAndParse
): Promise<number[]> => {
  const entries = assignIds(inputs)
  const excludedIds = await filterEntries(framework, entries, parse)
  return entries.filter((entry) => excludedIds.has(entry.id)).map((entry) => entry.item.chunkStart)
}

const scoutFileExcludes = async (
  file: string,
  framework: string,
  files: FileStore,
  parse: typeof callAndParse
): Promise<Set<number>> => {
  const content = files[file]
  if (content === undefined) return new Set()

  const source = getEmbeddableSource(file, files)
  if (source === null) return new Set()

  const chunks = chunkFileForEmbedding(content)
  if (chunks.length === 0) return new Set()

  const blocks = buildChunkBlocks(source, chunks)
  const calls = pack(
    blocks.map((block) => toEntryInput(file, block)),
    { sizeOf: entrySize, maxChars: SCOUT_MAX_CHARS }
  )

  const excluded = new Set<number>()
  for (const inputs of calls) {
    for (const chunkStart of await excludedInCall(framework, inputs, parse)) {
      excluded.add(chunkStart)
    }
  }
  return excluded
}

const uniqueFiles = (batch: SearchHit[]): string[] => [...new Set(batch.map((h) => h.file))]

const buildExcludeMap = async (
  files: FileStore,
  framework: string,
  filesInBatch: string[],
  parse: typeof callAndParse
): Promise<Map<string, Set<number>>> => {
  const map = new Map<string, Set<number>>()
  const pool = await processPool(
    filesInBatch,
    async (file) => {
      map.set(file, await scoutFileExcludes(file, framework, files, parse))
      return []
    },
    noop,
    { concurrency: SCOUT_CONCURRENCY }
  )
  const failure = pool.failures[0]
  if (failure) throw failure.error
  return map
}

const isExcluded = (hit: SearchHit, excludes: Map<string, Set<number>>): boolean => {
  if (hit.chunkStart === undefined) return false
  const fileExcludes = excludes.get(hit.file)
  if (!fileExcludes) return false
  return fileExcludes.has(hit.chunkStart)
}
