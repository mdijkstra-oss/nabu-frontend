import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { yieldToBrowser } from "~/lib/utils/async"
import { SETTINGS_FILE } from "~/lib/files/filename"
import { getEmbeddableSource, sliceSource } from "./source"
import { extendRegionsForAnnotations } from "./extend-annotations"

const isHitAlive = (hit: SearchHit, files: FileStore): boolean => {
  const content = files[hit.file]
  if (content === undefined) return false
  if (hit.id === undefined) return true
  return content.includes(hit.id)
}

const isHitFileUnchanged = (
  hit: SearchHit,
  files: FileStore,
  prevFiles: FileStore | undefined,
  settingsChanged: boolean
): boolean => !settingsChanged && !!prevFiles && prevFiles[hit.file] === files[hit.file]

const resliceHit = (hit: SearchHit, files: FileStore): SearchHit => {
  if (hit.chunkStart === undefined || hit.chunkEnd === undefined) return hit
  const source = getEmbeddableSource(hit.file, files)
  if (source === null) return hit
  return { ...hit, text: sliceSource(source, hit.chunkStart, hit.chunkEnd) }
}

const refreshHit = (hit: SearchHit, files: FileStore): SearchHit[] =>
  extendRegionsForAnnotations([resliceHit(hit, files)], files)

const dedupeKey = (hit: SearchHit): string =>
  `${hit.file}\0${hit.chunkStart ?? "-"}\0${hit.chunkEnd ?? "-"}\0${hit.id ?? ""}`

const deduplicate = (hits: SearchHit[]): SearchHit[] => {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  let dropped = false
  for (const h of hits) {
    const key = dedupeKey(h)
    if (seen.has(key)) {
      dropped = true
      continue
    }
    seen.add(key)
    out.push(h)
  }
  return dropped ? out : hits
}

const sameRefs = (a: SearchHit[], b: SearchHit[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

export const refreshHits = (
  hits: SearchHit[],
  files: FileStore,
  prevFiles?: FileStore
): SearchHit[] => {
  const settingsChanged = !!prevFiles && prevFiles[SETTINGS_FILE] !== files[SETTINGS_FILE]
  const refreshed: SearchHit[] = []
  for (const h of hits) {
    if (!isHitAlive(h, files)) continue
    if (isHitFileUnchanged(h, files, prevFiles, settingsChanged)) {
      refreshed.push(h)
      continue
    }
    refreshed.push(...refreshHit(h, files))
  }
  const deduped = deduplicate(refreshed)
  return sameRefs(deduped, hits) ? hits : deduped
}

export const refreshHitsAsync = async (
  hits: SearchHit[],
  files: FileStore,
  isCancelled: () => boolean,
  prevFiles?: FileStore
): Promise<SearchHit[]> => {
  const settingsChanged = !!prevFiles && prevFiles[SETTINGS_FILE] !== files[SETTINGS_FILE]
  const refreshed: SearchHit[] = []
  for (const h of hits) {
    if (isCancelled()) return refreshed
    if (!isHitAlive(h, files)) continue
    if (isHitFileUnchanged(h, files, prevFiles, settingsChanged)) {
      refreshed.push(h)
      continue
    }
    refreshed.push(...refreshHit(h, files))
    await yieldToBrowser()
  }
  const deduped = deduplicate(refreshed)
  return sameRefs(deduped, hits) ? hits : deduped
}
