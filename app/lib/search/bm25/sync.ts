import type { FileStore } from "~/lib/files/store"
import { debounce } from "~/lib/utils/debounce"
import { isCompanionFile, sourceFilename, parseCompanionEntries } from "~/lib/embeddings/companion"
import type { EmbeddingEntry } from "~/lib/embeddings/diff"
import { bm25DocId, replaceFile, removeFileFromAllLanguages, resetBm25 } from "./store"
import type { Bm25Doc } from "./store"

const BM25_SYNC_DEBOUNCE = 200

interface Bm25SyncDeps {
  getFiles: () => FileStore
  subscribe: (listener: () => void) => () => void
}

const groupByLanguage = (entries: EmbeddingEntry[], file: string): Map<string, Bm25Doc[]> => {
  const grouped = new Map<string, Bm25Doc[]>()
  for (const entry of entries) {
    const language = entry.language
    if (!language) continue
    const doc: Bm25Doc = {
      id: bm25DocId(file, entry.chunkStart),
      hash: entry.hash,
      file,
      text: entry.text,
      chunkStart: entry.chunkStart,
      chunkEnd: entry.chunkEnd,
      language,
    }
    const bucket = grouped.get(language) ?? []
    bucket.push(doc)
    grouped.set(language, bucket)
  }
  return grouped
}

const syncCompanion = (companionFile: string, content: string): void => {
  const source = sourceFilename(companionFile)
  const entries = parseCompanionEntries(content)
  const grouped = groupByLanguage(entries, source)
  removeFileFromAllLanguages(source)
  for (const [language, docs] of grouped) replaceFile(language, source, docs)
}

const findDirtyCompanions = (prev: FileStore, next: FileStore): string[] =>
  Object.keys(next).filter((f) => isCompanionFile(f) && next[f] !== prev[f])

const findDeletedCompanions = (prev: FileStore, next: FileStore): string[] =>
  Object.keys(prev).filter((f) => isCompanionFile(f) && !(f in next))

const processSync = (prev: FileStore, next: FileStore): void => {
  for (const companion of findDeletedCompanions(prev, next)) {
    removeFileFromAllLanguages(sourceFilename(companion))
  }
  for (const companion of findDirtyCompanions(prev, next)) {
    syncCompanion(companion, next[companion])
  }
}

export interface Bm25SyncHandle {
  ready: Promise<void>
}

export const startBm25Sync = (deps: Bm25SyncDeps): Bm25SyncHandle => {
  resetBm25()
  let previousFiles: FileStore = {}

  const run = (): void => {
    const currentFiles = deps.getFiles()
    processSync(previousFiles, currentFiles)
    previousFiles = currentFiles
  }

  run()
  const debouncedRun = debounce(run, BM25_SYNC_DEBOUNCE)
  deps.subscribe(debouncedRun)

  return { ready: Promise.resolve() }
}
