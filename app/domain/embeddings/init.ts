import { subscribe, getFiles, getFile, updateFileRaw, deleteFile } from "~/lib/files/store"
import { getEmbeddingsHost } from "~/lib/embeddings/env"
import { startEmbeddingSync } from "~/lib/embeddings/sync"

type OnSyncProgress = (processed: number, total: number) => void

export const startEmbeddings = (onProgress?: OnSyncProgress): Promise<void> =>
  startEmbeddingSync({
    getFiles,
    getFile,
    updateFile: updateFileRaw,
    deleteFile,
    subscribe,
    baseUrl: getEmbeddingsHost(),
    onProgress,
  }).ready
