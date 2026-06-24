import { UxSchema, type Ux } from "./schema"
import { getBlock } from "~/lib/data-blocks/query"
import type { FileStore } from "~/lib/files/store"
import { SETTINGS_FILE } from "~/lib/files/filename"

export const getUx = (raw: string): Ux | null => getBlock(raw, "json-ux", UxSchema)

export const getSelectedCodes = (files: FileStore): Set<string> =>
  new Set(getUx(files[SETTINGS_FILE] ?? "")?.selectedCodes ?? [])

export const getSelectedDocs = (files: FileStore): Set<string> =>
  new Set(getUx(files[SETTINGS_FILE] ?? "")?.selectedDocs ?? [])

export const getSelectedDocsOrdered = (files: FileStore): string[] =>
  getUx(files[SETTINGS_FILE] ?? "")?.selectedDocs ?? []

export const selectedFiles = (files: FileStore, currentFile: string | null): string[] => {
  const ordered = getSelectedDocsOrdered(files)
  if (!currentFile) return ordered
  return [currentFile, ...ordered.filter((id) => id !== currentFile)]
}

const toggleId = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]

export const toggleSelectedCode = (codes: string[], id: string): string[] => toggleId(codes, id)

export const toggleSelectedDoc = (docs: string[], id: string): string[] => toggleId(docs, id)

export type SelectionState = "none" | "partial" | "all"

export const selectionState = (selected: Set<string>, ids: string[]): SelectionState => {
  if (ids.length === 0) return "none"
  const count = ids.reduce((n, id) => (selected.has(id) ? n + 1 : n), 0)
  if (count === 0) return "none"
  return count === ids.length ? "all" : "partial"
}

export const addIds = (current: string[], ids: string[]): string[] => [
  ...new Set([...current, ...ids]),
]

export const removeIds = (current: string[], ids: string[]): string[] => {
  const drop = new Set(ids)
  return current.filter((id) => !drop.has(id))
}
