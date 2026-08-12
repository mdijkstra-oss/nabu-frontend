import { groupBy } from "~/lib/utils/group"
import { getKind, type RegionValueType } from "~/lib/regions/kinds/registry"
import type { ResolvedRegionRow } from "~/domain/data-blocks/regions/schema"
import type { InferredMeta, InferredMetaValue } from "./schema"

type Reducer = (regions: ResolvedRegionRow[]) => InferredMetaValue | undefined

const distinctValues: Reducer = (regions) => {
  const ordered = [...regions].sort((a, b) => a.startSentence - b.startSentence)
  const seen = new Set<string>()
  for (const r of ordered) seen.add(r.parsed.value)
  return seen.size === 0 ? undefined : [...seen]
}

// Sorted by instant rather than by string: detection normalizes to a Z-suffixed form,
// but a row hand-edited in the raw markdown can carry an offset, and then the two orders
// disagree. A value that is not a timestamp at all sorts last and never becomes an edge.
const byInstant = (a: string, b: string): number => Date.parse(a) - Date.parse(b)

const span: Reducer = (regions) => {
  const instants = regions
    .map((region) => region.parsed.value)
    .filter((value) => !Number.isNaN(Date.parse(value)))
    .sort(byInstant)
  if (instants.length === 0) return undefined
  return { start: instants[0], end: instants[instants.length - 1] }
}

// Total over the value-type union, which is what keeps a kind's values reducible.
const REDUCERS: Record<RegionValueType, Reducer> = {
  string: distinctValues,
  datetime: span,
}

// An empty result is an absent key, never an empty value: absence arrives in SQL as
// NULL, which is the honest reading of "no information".
export const reduceByKind = (regions: ResolvedRegionRow[]): InferredMeta | undefined => {
  const meta: InferredMeta = {}
  for (const [kindId, group] of groupBy(regions, (region) => region.kind)) {
    const kind = getKind(kindId)
    if (!kind) continue
    const value = REDUCERS[kind.valueType](group)
    if (value !== undefined) meta[kindId] = value
  }
  return Object.keys(meta).length === 0 ? undefined : meta
}
