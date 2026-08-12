import { groupBy } from "~/lib/utils/group"

// Windows and overlaps are both per kind: a date hit never bounds a speaker window, and
// two regions of different kinds are meant to overlap.
export const groupByKind = <T extends { kind: string }>(items: T[]): T[][] => [
  ...groupBy(items, (item) => item.kind).values(),
]
