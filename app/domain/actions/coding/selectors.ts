import type { FileStore } from "~/lib/files/store"
import { GENERATED_SUFFIX } from "~/lib/files/filename"
import { groupCodesByFile } from "~/domain/data-blocks/callout/codes/selectors"

const toHiddenFile = (codeId: string): string => `${codeId}${GENERATED_SUFFIX}`

export interface CodingFileRef {
  file: string
  hidden: boolean
}

export const resolveCodingFiles = (files: FileStore, selectedIds: string[]): CodingFileRef[] => {
  const selected = new Set(selectedIds)
  const groups = groupCodesByFile(files)

  return groups.flatMap((group) => {
    const matching = group.codes.filter((c) => selected.has(c.id))
    if (matching.length === 0) return []

    const isFullFile = matching.length === group.codes.length
    if (isFullFile) return [{ file: group.fileId, hidden: false }]

    return matching.map((c) => ({ file: toHiddenFile(c.id), hidden: true }))
  })
}
