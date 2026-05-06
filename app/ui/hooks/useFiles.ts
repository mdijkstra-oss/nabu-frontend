import { useMemo, useSyncExternalStore } from "react"
import {
  getFiles,
  getCurrentFile,
  getFileLineCount,
  getCodebook,
  setCurrentFile,
  subscribe,
} from "~/lib/files/store"
import { getTags } from "~/domain/data-blocks/attributes/tags/selectors"
import { getFileDate } from "~/domain/data-blocks/attributes/date/selectors"
import { getAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import { getTagDefinitions } from "~/domain/data-blocks/settings/tags/selectors"
import { buildIdentifierResolver } from "~/lib/files/selectors"

export const useFiles = () => {
  const files = useSyncExternalStore(subscribe, getFiles)
  const currentFile = useSyncExternalStore(subscribe, getCurrentFile)
  const codebook = useSyncExternalStore(subscribe, getCodebook)

  return useMemo(
    () => ({
      files,
      currentFile,
      codebook,
      setCurrentFile,
      getFileTags: (filename: string): string[] => getTags(files[filename] ?? ""),
      getFileDate: (filename: string): string | undefined => getFileDate(files[filename] ?? ""),
      getFileLineCount: (filename: string): number => getFileLineCount(filename),
      getFileAnnotations: (filename: string) => getAnnotations(files, files[filename] ?? ""),
      tagDefinitions: getTagDefinitions(files),
      resolveIds: buildIdentifierResolver(files),
    }),
    [files, currentFile, codebook]
  )
}
