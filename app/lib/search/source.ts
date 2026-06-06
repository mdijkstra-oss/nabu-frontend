import type { FileStore } from "~/lib/files/store"
import { extractProse } from "~/lib/data-blocks/parse"
import { createCappedCache } from "~/lib/utils/cache"
import { companionFilename, fastParseBlockContents } from "~/lib/embeddings/companion"

const sourceCache = createCappedCache<string, string>(500)

export const getEmbeddableSource = (file: string, files: FileStore): string | null => {
  const content = files[file]
  if (content === undefined) return null
  const cached = sourceCache.get(content)
  if (cached !== undefined) return cached
  const source = extractProse(content)
  sourceCache.set(content, source)
  return source
}

export const sliceSource = (source: string, start: number, end: number): string =>
  source.slice(start, end)

const chunkCountCache = createCappedCache<string, number>(500)

export const getTotalChunks = (file: string, files: FileStore): number => {
  const companion = files[companionFilename(file)]
  if (!companion) return 0
  const cached = chunkCountCache.get(companion)
  if (cached !== undefined) return cached
  const count = fastParseBlockContents(companion).length
  chunkCountCache.set(companion, count)
  return count
}

export const getTotalChunksByFiles = (
  fileNames: Iterable<string>,
  files: FileStore
): Map<string, number> => {
  const map = new Map<string, number>()
  for (const file of fileNames) {
    if (!map.has(file)) map.set(file, getTotalChunks(file, files))
  }
  return map
}
