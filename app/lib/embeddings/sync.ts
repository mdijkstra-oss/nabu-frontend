import type { FileStore } from "~/lib/files/store"
import { debounce } from "~/lib/utils/debounce"
import { processPool } from "~/lib/utils/pool"
import { isEmbeddableFile } from "./filter"
import { companionFilename, buildCompanionMarkdown, parseCompanionEntries } from "./companion"
import { chunkFileForEmbedding, type Chunk } from "./chunk"
import { diffChunks, type EmbeddingEntry } from "./diff"
import { fetchEmbeddingBatch } from "./client"
import { getEmbeddingsDimensions } from "./env"
import { EMBEDDING_SYNC_DEBOUNCE } from "./constants"
import { batchBySize } from "./batch"

import { detectLanguage } from "~/lib/language/detect"

export interface EmbeddingSyncDeps {
  getFiles: () => FileStore
  getFile: (f: string) => string | undefined
  updateFile: (f: string, content: string) => void
  deleteFile: (f: string) => void
  subscribe: (listener: () => void) => () => void
  embeddingsUrl: string
  onProgress?: (processed: number, total: number) => void
  fetchBatch?: typeof fetchEmbeddingBatch
}

interface FileChunks {
  filename: string
  entries: EmbeddingEntry[]
  needed: Chunk[]
}

interface TaggedChunk {
  filename: string
  chunk: Chunk
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
  const { keep, needed } = diffChunks(existing, chunks, getEmbeddingsDimensions())
  return { filename, entries: keep, needed }
}

const tagNeededChunks = (fileChunks: FileChunks[]): TaggedChunk[] =>
  fileChunks.flatMap((fc) => fc.needed.map((chunk) => ({ filename: fc.filename, chunk })))

const toBatches = (tagged: TaggedChunk[]): TaggedChunk[][] =>
  batchBySize(tagged, (t) => t.chunk.text.length)

const toEntryWithEmbedding = (chunk: Chunk, embedding: number[]): EmbeddingEntry => {
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

// A file whose chunks all matched still needs its companion reconciled: a chunk that is
// gone leaves an entry behind that goes on answering searches, and offsets move when text
// above them changes. A file with no prose left keeps no companion at all.
const settleUnchangedCompanions = (fileChunks: FileChunks[], deps: EmbeddingSyncDeps): void => {
  for (const fc of fileChunks) {
    if (fc.needed.length > 0) continue

    const companion = companionFilename(fc.filename)
    const stored = deps.getFile(companion)

    if (fc.entries.length === 0) {
      if (stored !== undefined) deps.deleteFile(companion)
      continue
    }

    const settled = buildCompanionMarkdown(fc.entries)
    if (settled !== stored) deps.updateFile(companion, settled)
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

  settleUnchangedCompanions(fileChunks, deps)

  const allTagged = tagNeededChunks(fileChunks)
  if (allTagged.length === 0) return

  const batches = toBatches(allTagged)
  const accumulated = new Map<string, EmbeddingEntry[]>()
  let processedChunks = 0
  deps.onProgress?.(0, allTagged.length)

  const fetchBatch = deps.fetchBatch ?? fetchEmbeddingBatch

  const embedBatch = async (batch: TaggedChunk[]): Promise<number[]> => {
    const texts = batch.map((t) => t.chunk.text)
    const result = await fetchBatch(texts, deps.embeddingsUrl)

    if (!result.ok) {
      console.error("[embeddings] fetch failed:", result.error)
      return []
    }

    // Merging positionally against a short answer would write entries with no vector,
    // which the companion reader then drops without a word. The batch is left in needed.
    if (result.value.length !== texts.length) {
      console.error(
        `[embeddings] provider answered ${result.value.length} of ${texts.length} chunks`
      )
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
