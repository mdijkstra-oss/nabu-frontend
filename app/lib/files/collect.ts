import type { FileStore } from "./store"
import { createCappedCache } from "~/lib/utils/cache"

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

interface FileStoreSelectorOptions<P, R> {
  extract: (raw: string) => P
  initial: () => R
  fold: (acc: R, partial: P, filename: string) => void
  cacheSize?: number
}

export const createFileStoreSelector = <P, R>(
  opts: FileStoreSelectorOptions<P, R>
): ((files: FileStore) => R) => {
  const cache = createCappedCache<string, P>(opts.cacheSize ?? 500)
  return (files: FileStore) => {
    const acc = opts.initial()
    for (const [filename, raw] of Object.entries(files)) {
      let partial: P
      if (cache.has(raw)) {
        partial = cache.get(raw) as P
      } else {
        partial = opts.extract(raw)
        cache.set(raw, partial)
      }
      opts.fold(acc, partial, filename)
    }
    return acc
  }
}
