import { UxSchema, type Ux } from "./schema"
import { getBlock } from "~/lib/data-blocks/query"
import { replaceSingletonBlock } from "~/lib/data-blocks/parse"
import { getFileRaw, updateFileRaw, type FileStore } from "~/lib/files/store"
import { SETTINGS_FILE } from "~/lib/files/filename"

export const getUx = (raw: string): Ux | null => getBlock(raw, "json-ux", UxSchema)

export const getSelectedCodes = (files: FileStore): Set<string> =>
  new Set(getUx(files[SETTINGS_FILE] ?? "")?.selectedCodes ?? [])

export const toggleSelectedCode = (codes: string[], id: string): string[] =>
  codes.includes(id) ? codes.filter((c) => c !== id) : [...codes, id]

export const writeSelectedCodes = (codes: string[]): string | null => {
  const raw = getFileRaw(SETTINGS_FILE)
  const current = getUx(raw) ?? {}
  const updated = { ...current, selectedCodes: codes }
  const newRaw = replaceSingletonBlock(raw, "json-ux", JSON.stringify(updated, null, 2))
  // UX: bypass finalizeContent + pending refs — json-ux is machine-generated state,
  // the full pipeline (validation, ID-fill, tag-ref-check, cross-file-scan) causes visible lag on toggle
  updateFileRaw(SETTINGS_FILE, newRaw, { immediate: true, skipPendingRefs: true })
  return null
}
