import { getFileRaw } from "~/lib/files/store"
import { executeFileAction } from "~/lib/data-blocks/file-action"
import type { Settings } from "~/domain/data-blocks/settings/schema"
import { getSettings } from "~/domain/data-blocks/settings/selectors"
import { SETTINGS_FILE } from "~/lib/files/filename"
import type { SearchEntry, EmbeddingsCache, NewSearchData } from "~/domain/search/types"

export type { NewSearchData }

const MAX_UNSAVED = 3

const generateShortId = (): string => {
  const digit = Math.floor(Math.random() * 10).toString()
  const rest = Math.random().toString(36).substring(2, 9)
  return digit + rest
}

const generateSearchId = (): string => `search-${generateShortId()}`

const isUnsaved = (entry: SearchEntry): boolean => !entry.saved

const rotateUnsaved = (entries: SearchEntry[]): SearchEntry[] => {
  const saved = entries.filter((e) => e.saved)
  const unsaved = entries.filter(isUnsaved)
  const sorted = [...unsaved].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return [...saved, ...sorted.slice(0, MAX_UNSAVED)]
}

const readSettings = (): Partial<Settings> => getSettings(getFileRaw(SETTINGS_FILE)) ?? {}

export const updateSearchEntries = (entries: SearchEntry[]): void => {
  executeFileAction({
    patches: [
      {
        path: SETTINGS_FILE,
        language: "json-settings",
        ops: [{ op: "add", path: "/searches", value: entries }],
      },
    ],
    immediate: true,
    skipPendingRefs: true,
  })
}

const bySql =
  (sql: string) =>
  (e: SearchEntry): boolean =>
    e.sql === sql

const bumpExisting = (
  entries: SearchEntry[],
  sql: string,
  embeddings?: EmbeddingsCache,
  meta?: Record<string, string>
): SearchEntry[] =>
  entries.map((e) =>
    e.sql === sql
      ? {
          ...e,
          createdAt: new Date().toISOString(),
          ...(embeddings && { embeddings }),
          ...(meta && { meta }),
        }
      : e
  )

export const saveNewSearch = (data: NewSearchData): string => {
  const settings = readSettings()
  const existing = (settings.searches ?? []).find(bySql(data.sql))

  if (existing) {
    const bumped = bumpExisting(settings.searches ?? [], data.sql, data.embeddings, data.meta)
    updateSearchEntries(bumped)
    return existing.id
  }

  const id = generateSearchId()
  const entry: SearchEntry = {
    id,
    title: data.title,
    description: data.description,
    highlight: data.highlight ?? "",
    saved: false,
    createdAt: new Date().toISOString(),
    sql: data.sql,
    ...(data.embeddings && { embeddings: data.embeddings }),
    ...(data.meta && { meta: data.meta }),
  }

  const withNew = [...(settings.searches ?? []), entry]
  const rotated = rotateUnsaved(withNew)
  updateSearchEntries(rotated)
  return id
}

export const updateSearchSql = (searchId: string, sql: string, highlight?: string): void => {
  const settings = readSettings()
  const entries = settings.searches ?? []
  const updated = entries.map((e) =>
    e.id === searchId ? { ...e, sql, ...(highlight && { highlight }) } : e
  )
  updateSearchEntries(updated)
}

export const updateSearchCache = (
  searchId: string,
  embeddings: EmbeddingsCache,
  highlight?: string
): void => {
  const settings = readSettings()
  const entries = settings.searches ?? []
  const updated = entries.map((e) =>
    e.id === searchId ? { ...e, embeddings, ...(highlight && { highlight }) } : e
  )
  updateSearchEntries(updated)
}
