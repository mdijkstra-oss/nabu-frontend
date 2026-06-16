import type { FileStore } from "~/lib/files/store"
import { debounce } from "~/lib/utils/debounce"
import { processPool } from "~/lib/utils/pool"
import { isEmbeddableFile } from "./filter"
import { companionFilename, buildCompanionMarkdown, parseCompanionEntries } from "./companion"
import { chunkFileForEmbedding } from "./chunk"
import { diffChunks, type EmbeddingEntry } from "./diff"
import { fetchEmbeddingBatch } from "./client"
import { EMBEDDING_SYNC_DEBOUNCE, MAX_EMBEDDING_BATCH_SIZE } from "./constants"

import { detectLanguage } from "~/lib/language/detect"

interface EmbeddingSyncDeps {
  getFiles: () => FileStore
  getFile: (f: string) => string | undefined
  updateFile: (f: string, content: string) => void
  deleteFile: (f: string) => void
  subscribe: (listener: () => void) => () => void
  baseUrl: string
  onProgress?: (processed: number, total: number) => void
}

interface NeededChunk {
  index: number
  text: string
  hash: string
  chunkStart: number
  chunkEnd: number
}

interface FileChunks {
  filename: string
  entries: EmbeddingEntry[]
  needed: NeededChunk[]
}

interface TaggedChunk {
  filename: string
  chunk: NeededChunk
}

const findDirtyFiles = (prev: FileStore, next: FileStore): string[] =>
  Object.keys(next).filter((f) => isEmbeddableFile(f) && next[f] !== prev[f])

const findDeletedFiles = (prev: FileStore, next: FileStore): string[] =>
  Object.keys(prev).filter((f) => isEmbeddableFile(f) && !(f in next))

const prepareFile = (
  filename: string,
  content: string,
  companionContent: string | undefined
): FileChunks => {
  const chunks = chunkFileForEmbedding(content)
  const existing = companionContent ? parseCompanionEntries(companionContent) : []
  const { keep, needed } = diffChunks(existing, chunks)
  return { filename, entries: keep, needed }
}

const tagNeededChunks = (fileChunks: FileChunks[]): TaggedChunk[] =>
  fileChunks.flatMap((fc) => fc.needed.map((chunk) => ({ filename: fc.filename, chunk })))

const toBatches = (tagged: TaggedChunk[]): TaggedChunk[][] => {
  const batches: TaggedChunk[][] = []
  for (let i = 0; i < tagged.length; i += MAX_EMBEDDING_BATCH_SIZE) {
    batches.push(tagged.slice(i, i + MAX_EMBEDDING_BATCH_SIZE))
  }
  return batches
}

const toEntryWithEmbedding = (chunk: NeededChunk, embedding: number[]): EmbeddingEntry => {
  const language = detectLanguage(chunk.text)
  return {
    hash: chunk.hash,
    text: chunk.text,
    embedding,
    chunkStart: chunk.chunkStart,
    chunkEnd: chunk.chunkEnd,
    ...(language ? { language } : {}),
  }
}

const mergeNewEntries = (
  batch: TaggedChunk[],
  embeddings: number[][],
  accumulated: Map<string, EmbeddingEntry[]>
): void => {
  for (let i = 0; i < batch.length; i++) {
    const { filename, chunk } = batch[i]
    const entries = accumulated.get(filename) ?? []
    entries.push(toEntryWithEmbedding(chunk, embeddings[i]))
    accumulated.set(filename, entries)
  }
}

const writeCompanions = (
  accumulated: Map<string, EmbeddingEntry[]>,
  fileChunks: FileChunks[],
  deps: EmbeddingSyncDeps
): void => {
  for (const fc of fileChunks) {
    const newEntries = accumulated.get(fc.filename)
    if (!newEntries) continue

    const allEntries = [...fc.entries, ...newEntries]
    const companion = companionFilename(fc.filename)
    deps.updateFile(companion, buildCompanionMarkdown(allEntries))
  }
}

const processSync = async (
  prev: FileStore,
  next: FileStore,
  deps: EmbeddingSyncDeps
): Promise<void> => {
  const dirty = findDirtyFiles(prev, next)
  const deleted = findDeletedFiles(prev, next)

  for (const filename of deleted) {
    const companion = companionFilename(filename)
    if (deps.getFile(companion) !== undefined) {
      deps.deleteFile(companion)
    }
  }

  if (dirty.length === 0) return

  const fileChunks = dirty.map((filename) => {
    const content = next[filename]
    const companion = deps.getFile(companionFilename(filename))
    return prepareFile(filename, content, companion)
  })

  const allTagged = tagNeededChunks(fileChunks)
  if (allTagged.length === 0) return

  const batches = toBatches(allTagged)
  const accumulated = new Map<string, EmbeddingEntry[]>()
  let processedChunks = 0
  deps.onProgress?.(0, allTagged.length)

  const embedBatch = async (batch: TaggedChunk[]): Promise<number[]> => {
    const texts = batch.map((t) => t.chunk.text)
    const result = await fetchEmbeddingBatch(texts, deps.baseUrl)

    if (!result.ok) {
      console.error("[embeddings] fetch failed:", result.error)
      return []
    }

    mergeNewEntries(batch, result.value, accumulated)
    writeCompanions(accumulated, fileChunks, deps)
    return [batch.length]
  }

  const reportBatchProgress = (counts: number[]) => {
    processedChunks += counts[0]
    deps.onProgress?.(processedChunks, allTagged.length)
  }

  await processPool(batches, embedBatch, reportBatchProgress, {})
}

interface EmbeddingSyncHandle {
  ready: Promise<void>
}

export const startEmbeddingSync = (deps: EmbeddingSyncDeps): EmbeddingSyncHandle => {
  let previousFiles: FileStore = {}
  let syncing = false

  const run = async (): Promise<void> => {
    if (syncing) return
    syncing = true

    try {
      const currentFiles = deps.getFiles()
      await processSync(previousFiles, currentFiles, deps)
      previousFiles = currentFiles
    } catch (e) {
      console.error("[embeddings] sync error:", e)
    } finally {
      syncing = false
    }
  }

  const ready = run()

  const debouncedRun = debounce(run, EMBEDDING_SYNC_DEBOUNCE)
  deps.subscribe(debouncedRun)

  return { ready }
}
