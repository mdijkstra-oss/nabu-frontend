import { getFiles } from "~/lib/files/store"
import { ingestFile } from "~/lib/files/ingest"
import { formatValidationErrors } from "~/lib/data-blocks/validate"
import { deduplicateName } from "./dedupe"
import { readFileContent, isMarkdownFile } from "./read"
import { normalizeFilename, isHiddenFile } from "~/lib/files/filename"
import { isEmbeddableFile } from "~/lib/embeddings/filter"
import type { ImportFile, ImportStatus } from "./types"

type StatusCallback = (id: string, status: ImportStatus, extra?: Partial<ImportFile>) => void

const getExistingNames = (): Set<string> => new Set(Object.keys(getFiles()))

const processMarkdownFile = (file: File, content: string, onStatus: StatusCallback): void => {
  const id = file.name
  const normalized = normalizeFilename(file.name)

  // The hidden check runs on the normalized name, before dedupe: normalizeFilename
  // lowercases (a raw "Notes.Hidden.md" only reveals its marker here), and a dedupe
  // suffix would split the ".hidden." marker apart and let the name slip through.
  // A hidden file would never receive engine events and its row would sit at
  // "Queued" forever.
  if (isHiddenFile(normalized)) {
    onStatus(id, "unsupported")
    return
  }

  const finalPath = deduplicateName(normalized, getExistingNames())

  // The engine only processes embeddable paths; a stored file it will never
  // touch gets no events and its row would sit at "Queued" forever.
  if (!isEmbeddableFile(finalPath)) {
    onStatus(id, "unsupported")
    return
  }

  onStatus(id, "processing", { finalPath })

  const result = ingestFile(finalPath, content)
  if (!result.ok) {
    onStatus(id, "error", { error: formatValidationErrors(result.errors) })
    return
  }

  onStatus(id, "pending")
}

const processFile = async (file: File, onStatus: StatusCallback): Promise<void> => {
  const id = file.name

  if (!isMarkdownFile(file.name)) {
    onStatus(id, "unsupported")
    return
  }

  onStatus(id, "reading")

  const readResult = await readFileContent(file)

  if (!readResult.ok) {
    onStatus(id, "error", { error: readResult.error })
    return
  }

  processMarkdownFile(file, readResult.content, onStatus)
}

export const processFiles = async (files: File[], onStatus: StatusCallback): Promise<void> => {
  for (const file of files) {
    await processFile(file, onStatus)
  }
}
