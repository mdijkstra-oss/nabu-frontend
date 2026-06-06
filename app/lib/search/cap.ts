import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { getTotalChunksByFiles } from "./source"

export interface RegionCapOptions {
  floor: number
  ratio: number
}

export const DEFAULT_REGION_CAP: RegionCapOptions = { floor: 10, ratio: 0.5 }

export const computeFileCap = (totalChunks: number, opts: RegionCapOptions): number => {
  if (totalChunks <= 0) return 0
  return Math.min(totalChunks, Math.max(opts.floor, Math.ceil(opts.ratio * totalChunks)))
}

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

export const capStage = (
  hits: SearchHit[],
  files: FileStore,
  opts: RegionCapOptions = DEFAULT_REGION_CAP
): SearchHit[] => {
  const fileNames = new Set(hits.map((h) => h.file))
  const totalsByFile = getTotalChunksByFiles(fileNames, files)
  return capByFile(hits, totalsByFile, opts)
}
