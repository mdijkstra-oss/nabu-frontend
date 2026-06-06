import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { getEmbeddableSource, sliceSource, getTotalChunksByFiles } from "./source"

export interface RegionCapOptions {
  floor: number
  ratio: number
}

export const DEFAULT_REGION_CAP: RegionCapOptions = { floor: 10, ratio: 0.5 }

export const computeFileCap = (totalChunks: number, opts: RegionCapOptions): number => {
  if (totalChunks <= 0) return 0
  return Math.min(totalChunks, Math.max(opts.floor, Math.ceil(opts.ratio * totalChunks)))
}

const hasOffsets = (hit: SearchHit): hit is SearchHit & { chunkStart: number; chunkEnd: number } =>
  hit.chunkStart !== undefined && hit.chunkEnd !== undefined

export const capByFile = (
  hits: SearchHit[],
  totalsByFile: Map<string, number>,
  opts: RegionCapOptions = DEFAULT_REGION_CAP
): SearchHit[] => {
  const accepted: SearchHit[] = []
  const counts = new Map<string, number>()
  for (const hit of hits) {
    const total = totalsByFile.get(hit.file) ?? 0
    const cap = computeFileCap(total, opts)
    const current = counts.get(hit.file) ?? 0
    if (current >= cap) continue
    accepted.push(hit)
    counts.set(hit.file, current + 1)
  }
  return accepted
}

const sortByStart = (hits: SearchHit[]): SearchHit[] =>
  [...hits].sort((a, b) => (a.chunkStart ?? 0) - (b.chunkStart ?? 0))

interface MergeRun {
  start: number
  end: number
  score: number
  anchor: SearchHit
}

const startRun = (hit: SearchHit & { chunkStart: number; chunkEnd: number }): MergeRun => ({
  start: hit.chunkStart,
  end: hit.chunkEnd,
  score: hit.score ?? 0,
  anchor: hit,
})

const extendRun = (
  run: MergeRun,
  hit: SearchHit & { chunkStart: number; chunkEnd: number }
): void => {
  run.end = Math.max(run.end, hit.chunkEnd)
  if ((hit.score ?? 0) > run.score) {
    run.score = hit.score ?? 0
    run.anchor = hit
  }
}

const emit = (run: MergeRun): SearchHit => ({
  ...run.anchor,
  chunkStart: run.start,
  chunkEnd: run.end,
  score: run.score,
})

export const mergeAdjacent = (hits: SearchHit[]): SearchHit[] => {
  const withOffsets = hits.filter(hasOffsets)
  const passThrough = hits.filter((h) => !hasOffsets(h))
  const byFile = new Map<string, (SearchHit & { chunkStart: number; chunkEnd: number })[]>()
  for (const hit of withOffsets) {
    const list = byFile.get(hit.file) ?? []
    list.push(hit)
    byFile.set(hit.file, list)
  }

  const merged: SearchHit[] = []
  for (const [, list] of byFile) {
    const sorted = sortByStart(list) as (SearchHit & { chunkStart: number; chunkEnd: number })[]
    let run: MergeRun | null = null
    for (const hit of sorted) {
      if (run && hit.chunkStart <= run.end) {
        extendRun(run, hit)
        continue
      }
      if (run) merged.push(emit(run))
      run = startRun(hit)
    }
    if (run) merged.push(emit(run))
  }

  return [...merged, ...passThrough]
}

export const toRegions = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  hits.map((hit) => {
    if (!hasOffsets(hit)) return hit
    const source = getEmbeddableSource(hit.file, files)
    if (source === null) return hit
    return { ...hit, text: sliceSource(source, hit.chunkStart, hit.chunkEnd) }
  })

export const buildRegions = (
  hits: SearchHit[],
  totalsByFile: Map<string, number>,
  files: FileStore,
  opts: RegionCapOptions = DEFAULT_REGION_CAP
): SearchHit[] => toRegions(mergeAdjacent(capByFile(hits, totalsByFile, opts)), files)

export const groupAdjacent = (
  hits: SearchHit[],
  files: FileStore,
  opts: RegionCapOptions = DEFAULT_REGION_CAP
): SearchHit[] => {
  const fileNames = new Set(hits.map((h) => h.file))
  const totalsByFile = getTotalChunksByFiles(fileNames, files)
  return buildRegions(hits, totalsByFile, files, opts)
}
