import { UxSchema, type Ux } from "./schema"
import { getBlock } from "~/lib/data-blocks/query"
import { replaceSingletonBlock } from "~/lib/data-blocks/parse"
import { finalizeContent } from "~/lib/patch/apply"
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
  const result = finalizeContent(SETTINGS_FILE, newRaw, { original: raw })
  if (result.status === "error") return result.error
  updateFileRaw(result.path, result.content, { immediate: true })
  return null
}
