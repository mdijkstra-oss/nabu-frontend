import { getSettings } from "../selectors"
import { SETTINGS_FILE } from "~/lib/files/filename"
import type { FileStore } from "~/lib/files/store"
import type { SearchEntry } from "~/domain/search/types"

export const getSearchEntries = (files: FileStore): SearchEntry[] =>
  getSettings(files[SETTINGS_FILE] ?? "")?.searches ?? []

export const findSearchById = (files: FileStore, id: string): SearchEntry | undefined =>
  getSearchEntries(files).find((s) => s.id === id)

const byCreatedAtDesc = (a: SearchEntry, b: SearchEntry): number => b.createdAt - a.createdAt

export const getRecentSearches = (files: FileStore): SearchEntry[] =>
  getSearchEntries(files)
    .filter((s) => !s.saved)
    .sort(byCreatedAtDesc)

export const getSavedSearches = (files: FileStore): SearchEntry[] =>
  getSearchEntries(files)
    .filter((s) => s.saved)
    .sort(byCreatedAtDesc)

export const toggleSearchSaved = (entries: SearchEntry[], id: string): SearchEntry[] =>
  entries.map((e) => (e.id === id ? { ...e, saved: !e.saved } : e))

export const removeSearch = (entries: SearchEntry[], id: string): SearchEntry[] =>
  entries.filter((e) => e.id !== id)
