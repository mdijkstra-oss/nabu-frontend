import { findMatchOffset } from "~/lib/text/find"
import { findOverlappingRange, type SentenceRow } from "~/lib/text/halo"
import {
  isResolved,
  type RegionRow,
  type ResolvedRegionRow,
} from "~/domain/data-blocks/regions/schema"

export interface SentenceScope {
  first: number
  last: number
}

export const scopeOfDocument = (rows: readonly SentenceRow[]): SentenceScope | null =>
  rows.length === 0 ? null : { first: 0, last: rows.length - 1 }

export const scopeOfQuote = (
  prose: string,
  rows: readonly SentenceRow[],
  quote: string
): SentenceScope | null => {
  const offset = findMatchOffset(prose, quote)
  if (!offset) return null
  const overlap = findOverlappingRange(rows, offset.start, offset.end)
  return overlap ? { first: overlap.firstIdx, last: overlap.lastIdx } : null
}

export const scopeOfPoint = (
  rows: readonly SentenceRow[],
  proseOffset: number
): SentenceScope | null => {
  if (rows.length === 0) return null
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].end <= proseOffset) return { first: i, last: i }
  }
  return { first: 0, last: 0 }
}

const intersects = (scope: SentenceScope, region: ResolvedRegionRow): boolean =>
  region.startSentence <= scope.last && region.endSentence >= scope.first

export const regionsInScope = (
  regions: readonly RegionRow[],
  scope: SentenceScope,
  excludedKind?: string
): ResolvedRegionRow[] =>
  regions.filter(
    (region): region is ResolvedRegionRow =>
      region.kind !== excludedKind && isResolved(region) && intersects(scope, region)
  )
