import { REGION_KIND_IDS } from "~/lib/regions/kinds/registry"
import type { RegionRow, RegionsBlock, ScannedUnit } from "./schema"

const kindRank = (kind: string): number => {
  const rank = REGION_KIND_IDS.indexOf(kind)
  return rank === -1 ? REGION_KIND_IDS.length : rank
}

const firstSentenceOf = (row: RegionRow): number => row.startSentence ?? row.hitSentence

const compareRows = (a: RegionRow, b: RegionRow): number =>
  kindRank(a.kind) - kindRank(b.kind) ||
  firstSentenceOf(a) - firstSentenceOf(b) ||
  a.hitSentence - b.hitSentence

const compareUnits = (a: ScannedUnit, b: ScannedUnit): number => a.firstSentence - b.firstSentence

// Two orderings of the same regions are the same data and a different file, and the
// sync writes only when its derived bytes differ from the stored ones.
export const canonicalizeRegionsBlock = (block: RegionsBlock): RegionsBlock => ({
  regions: [...block.regions].sort(compareRows),
  scanned: Object.fromEntries(
    Object.keys(block.scanned)
      .sort((a, b) => kindRank(a) - kindRank(b))
      .map((kind) => [kind, [...block.scanned[kind]].sort(compareUnits)])
  ),
})
