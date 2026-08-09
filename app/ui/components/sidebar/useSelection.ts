import { useMemo } from "react"
import type { FileStore } from "~/lib/files/store"

export const EMPTY_SELECTION: ReadonlySet<string> = new Set()

export const useSelection = (
  files: FileStore,
  getSelected: (files: FileStore) => Set<string>,
  toggle: (ids: string[], id: string) => string[],
  write: (ids: string[]) => void
) => {
  const selected = useMemo(() => getSelected(files), [files, getSelected])
  const toggleSelection = (id: string) => write(toggle([...selected], id))
  return { selected, toggleSelection }
}
