import { subscribe, getFiles, getFile, updateFileRaw, deleteFile } from "~/lib/files/store"
import { getLlmHost } from "~/lib/agent/env"
import { startEmbeddingSync } from "~/lib/embeddings/sync"

type OnSyncProgress = (processed: number, total: number) => void

export const startEmbeddings = (onProgress?: OnSyncProgress): Promise<void> =>
  startEmbeddingSync({
    getFiles,
    getFile,
    updateFile: updateFileRaw,
    deleteFile,
    subscribe,
    baseUrl: getLlmHost(),
    onProgress,
  }).ready
