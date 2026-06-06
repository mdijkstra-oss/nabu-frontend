import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { getEmbeddableSource, sliceSource } from "./source"

export interface SeedGateOptions {
  ratio: number
}

export const DEFAULT_SEED_GATE_RATIO = 0.6

const hasOffsets = (hit: SearchHit): hit is SearchHit & { chunkStart: number; chunkEnd: number } =>
  hit.chunkStart !== undefined && hit.chunkEnd !== undefined

interface Region {
  start: number
  end: number
  anchor: SearchHit & { chunkStart: number; chunkEnd: number }
  file: string
  scores: number[]
}

const byteOverlaps = (
  region: Region,
  hit: SearchHit & { chunkStart: number; chunkEnd: number }
): boolean => hit.chunkStart <= region.end && hit.chunkEnd >= region.start

const passesGate = (
  hit: SearchHit & { chunkStart: number; chunkEnd: number },
  anchor: SearchHit,
  ratio: number
): boolean => {
  const anchorScore = anchor.score ?? 0
  if (anchorScore === 0) return true
  const hitScore = hit.score ?? 0
  return hitScore / anchorScore >= ratio
}

const extend = (
  region: Region,
  hit: SearchHit & { chunkStart: number; chunkEnd: number }
): void => {
  region.start = Math.min(region.start, hit.chunkStart)
  region.end = Math.max(region.end, hit.chunkEnd)
  region.scores.push(hit.score ?? 0)
}

const emit = (region: Region): SearchHit => ({
  ...region.anchor,
  chunkStart: region.start,
  chunkEnd: region.end,
  score: region.anchor.score,
  constituentScores: region.scores,
})

export const seedAndGrow = (
  hits: SearchHit[],
  opts: SeedGateOptions = { ratio: DEFAULT_SEED_GATE_RATIO }
): SearchHit[] => {
  const regionsBySeedOrder: Region[] = []
  const regionsByFile = new Map<string, Region[]>()
  const passThrough: SearchHit[] = []

  for (const hit of hits) {
    if (!hasOffsets(hit)) {
      passThrough.push(hit)
      continue
    }

    const fileRegions = regionsByFile.get(hit.file) ?? []
    const overlapping = fileRegions.filter((r) => byteOverlaps(r, hit))

    if (overlapping.length === 0) {
      const region: Region = {
        start: hit.chunkStart,
        end: hit.chunkEnd,
        anchor: hit,
        file: hit.file,
        scores: [hit.score ?? 0],
      }
      regionsBySeedOrder.push(region)
      fileRegions.push(region)
      regionsByFile.set(hit.file, fileRegions)
      continue
    }

    if (overlapping.length > 1) continue

    const region = overlapping[0]
    if (passesGate(hit, region.anchor, opts.ratio)) extend(region, hit)
  }

  return [...regionsBySeedOrder.map(emit), ...passThrough]
}

export const toRegions = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  hits.map((hit) => {
    if (!hasOffsets(hit)) return hit
    const source = getEmbeddableSource(hit.file, files)
    if (source === null) return hit
    return { ...hit, text: sliceSource(source, hit.chunkStart, hit.chunkEnd) }
  })

export const mergeStage = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  toRegions(seedAndGrow(hits), files)
