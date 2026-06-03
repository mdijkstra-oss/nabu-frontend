import { UxSchema, type Ux } from "./schema"
import { getBlock } from "~/lib/data-blocks/query"
import type { FileStore } from "~/lib/files/store"
import { SETTINGS_FILE } from "~/lib/files/filename"
import { memoByRef } from "~/lib/utils/memo"

export const getUx = (raw: string): Ux | null => getBlock(raw, "json-ux", UxSchema)

export const getSelectedCodes = memoByRef(
  (files: FileStore): Set<string> => new Set(getUx(files[SETTINGS_FILE] ?? "")?.selectedCodes ?? [])
)

export const toggleSelectedCode = (codes: string[], id: string): string[] =>
  codes.includes(id) ? codes.filter((c) => c !== id) : [...codes, id]
