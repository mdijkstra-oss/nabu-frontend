import type { FileStore } from "./store"

export const collectAll = <T>(files: FileStore, extract: (raw: string) => T[]): T[] =>
  Object.values(files).flatMap(extract)

export const findIn = <T>(
  files: FileStore,
  extract: (raw: string) => T[],
  predicate: (item: T) => boolean
): T | undefined => collectAll(files, extract).find(predicate)

export const findFileFor = <T>(
  files: FileStore,
  extract: (raw: string) => T[],
  predicate: (item: T) => boolean
): string | undefined => Object.entries(files).find(([_, raw]) => extract(raw).some(predicate))?.[0]
