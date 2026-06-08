import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { trimByRanges, type TrimmedRegion } from "~/lib/text/trim-around"
import { getEmbeddableSource } from "./source"

const stripLonelyEllipses = (text: string): string =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "…")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "")

const cleanRegion = (region: TrimmedRegion): TrimmedRegion => ({
  ...region,
  text: stripLonelyEllipses(region.text),
})

const offsetRegion = (region: TrimmedRegion, base: number): TrimmedRegion => ({
  ...region,
  sourceStart: base + region.sourceStart,
  sourceEnd: base + region.sourceEnd,
})

const sliceLeading = (source: string | null, hit: SearchHit): string =>
  source !== null && hit.chunkStart !== undefined ? source.slice(0, hit.chunkStart) : ""

const sliceTrailing = (source: string | null, hit: SearchHit): string =>
  source !== null && hit.chunkEnd !== undefined ? source.slice(hit.chunkEnd) : ""

const trimHit = (hit: SearchHit, source: string | null): SearchHit[] => {
  if (!hit.matchRanges || hit.matchRanges.length === 0 || !hit.text) return [hit]
  const base = hit.chunkStart ?? 0
  const regions = trimByRanges(hit.text, hit.matchRanges, {
    leading: sliceLeading(source, hit),
    trailing: sliceTrailing(source, hit),
  })
    .map((r) => offsetRegion(cleanRegion(r), base))
    .filter((r) => r.text.length > 0)
  if (regions.length === 0) return []
  if (regions.length === 1) {
    const r = regions[0]
    return [{ ...hit, text: r.text, chunkStart: r.sourceStart, chunkEnd: r.sourceEnd }]
  }
  return regions.map((r, i) => ({
    ...hit,
    text: r.text,
    chunkStart: r.sourceStart,
    chunkEnd: r.sourceEnd,
    splitIndex: i,
    splitTotal: regions.length,
  }))
}

export const trim = (hits: SearchHit[], files: FileStore): SearchHit[] =>
  hits.flatMap((hit) => trimHit(hit, getEmbeddableSource(hit.file, files)))
