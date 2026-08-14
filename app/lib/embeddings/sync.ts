import { companionFilename, buildCompanionMarkdown, parseCompanionEntries } from "./companion"
import { chunkFileForEmbedding, type Chunk } from "./chunk"
import { diffChunks, type EmbeddingEntry } from "./diff"
import { fetchEmbeddingBatch } from "./client"
import { getEmbeddingsDimensions } from "./env"
import { batchBySize } from "./batch"

import { detectLanguage } from "~/lib/language/detect"
import type { StagePassPlan } from "~/lib/engine/types"

export interface EmbedFileAccess {
  getFile: (f: string) => string | undefined
  updateFile: (f: string, content: string) => void
  deleteFile: (f: string) => void
}

export interface EmbedFilePassDeps extends EmbedFileAccess {
  embeddingsUrl: string
  fetchBatch?: typeof fetchEmbeddingBatch
}

export const planEmbedFilePass = (
  filename: string,
  content: string,
  deps: EmbedFilePassDeps
): StagePassPlan => {
  const prepared = prepareFile(filename, content, deps.getFile(companionFilename(filename)))

  if (prepared.needed.length === 0) {
    return {
      dirty: false,
      run: () => {
        settleUnchangedCompanion(prepared, deps)
        return Promise.resolve()
      },
    }
  }

  const fetchBatch = deps.fetchBatch ?? fetchEmbeddingBatch

  const run = async (): Promise<void> => {
    const entries = [...prepared.entries]
    for (const batch of batchBySize(prepared.needed, (chunk) => chunk.text.length)) {
      const result = await fetchBatch(
        batch.map((chunk) => chunk.text),
        deps.embeddingsUrl
      )
      if (!result.ok) throw new Error(`embeddings fetch failed: ${result.error.message}`)

      // Merging positionally against a short answer would write entries with no vector,
      // which the companion reader then drops without a word.
      if (result.value.length !== batch.length) {
        throw new Error(`provider answered ${result.value.length} of ${batch.length} chunks`)
      }

      for (let i = 0; i < batch.length; i++) {
        entries.push(toEntryWithEmbedding(batch[i], result.value[i]))
      }
      deps.updateFile(companionFilename(filename), buildCompanionMarkdown(entries))
    }
  }

  return { dirty: true, run }
}

interface FileChunks {
  filename: string
  entries: EmbeddingEntry[]
  needed: Chunk[]
}

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

const settleUnchangedCompanion = (fc: FileChunks, deps: EmbedFileAccess): void => {
  const companion = companionFilename(fc.filename)
  const stored = deps.getFile(companion)

  if (fc.entries.length === 0) {
    if (stored !== undefined) deps.deleteFile(companion)
    return
  }

  const settled = buildCompanionMarkdown(fc.entries)
  if (settled !== stored) deps.updateFile(companion, settled)
}
