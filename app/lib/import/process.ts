import { updateFileRaw, getFiles } from "~/lib/files/store"
import { deduplicateName } from "./dedupe"
import { readFileContent, isMarkdownFile } from "./read"
import { normalizeFilename } from "~/lib/files/filename"
import type { ImportFile, ImportStatus } from "./types"

interface ProcessResult {
  status: ImportStatus
  error?: string
  finalPath?: string
}

type StatusCallback = (id: string, status: ImportStatus, extra?: Partial<ImportFile>) => void

const getExistingNames = (): Set<string> => new Set(Object.keys(getFiles()))

const processMarkdownFile = (file: File, content: string): ProcessResult => {
  const existingNames = getExistingNames()
  const finalPath = deduplicateName(normalizeFilename(file.name), existingNames)

  updateFileRaw(finalPath, content)

  return { status: "completed", finalPath }
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

  onStatus(id, "processing")

  const processResult = processMarkdownFile(file, readResult.content)

  onStatus(id, processResult.status, {
    error: processResult.error,
    finalPath: processResult.finalPath,
  })
}

export const processFiles = async (files: File[], onStatus: StatusCallback): Promise<void> => {
  for (const file of files) {
    await processFile(file, onStatus)
  }
}
