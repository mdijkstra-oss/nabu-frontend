// How a work list becomes calls: batches close on a character budget and an
// item cap, optionally keeping groups together. Pure.

import { groupBy } from "~/lib/utils/group"

export interface PackOptions<T> {
  // Cost in characters, measured on what will actually be rendered.
  sizeOf: (item: T) => number
  // A batch closes before exceeding this; the first item always enters, so a
  // batch is never empty and an oversized item gets a call of its own.
  maxChars: number
  // A batch closes at this count regardless of remaining budget.
  maxItems?: number
  // Items sharing a key stay together: a group of at least maxItems fills
  // batches of its own including its remainder; only smaller groups mix, at
  // most maxGroups distinct keys per batch, largest leftover group first.
  groupKey?: (item: T) => string
  maxGroups?: number
}

export const pack = <T>(items: readonly T[], options: PackOptions<T>): T[][] => {
  if (!options.groupKey) return fillInOrder(items, options)

  const singleKeyBatches: T[][] = []
  const mixable: T[][] = []
  for (const group of groupBy(items, options.groupKey).values()) {
    if (fillsBatchesAlone(group, options)) singleKeyBatches.push(...fillInOrder(group, options))
    else mixable.push(group)
  }
  return [...singleKeyBatches, ...mixSmallGroups(mixable, options)]
}

const fillsBatchesAlone = <T>(group: readonly T[], options: PackOptions<T>): boolean =>
  group.length >= (options.maxItems ?? Infinity) ||
  charsOf(group, options.sizeOf) > options.maxChars

const fillInOrder = <T>(items: readonly T[], options: PackOptions<T>): T[][] => {
  const { sizeOf, maxChars } = options
  const cap = options.maxItems ?? Infinity
  const batches: T[][] = []
  let current: T[] = []
  let chars = 0

  for (const item of items) {
    const size = sizeOf(item)
    if (current.length > 0 && (chars + size > maxChars || current.length >= cap)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(item)
    chars += size
  }

  if (current.length > 0) batches.push(current)
  return batches
}

const mixSmallGroups = <T>(groups: readonly T[][], options: PackOptions<T>): T[][] => {
  const { sizeOf, maxChars } = options
  const cap = options.maxItems ?? Infinity
  const keyCap = options.maxGroups ?? Infinity
  const largestFirst = [...groups].sort((a, b) => b.length - a.length)
  const batches: T[][] = []
  let current: T[] = []
  let chars = 0
  let keys = 0

  for (const group of largestFirst) {
    const groupChars = charsOf(group, sizeOf)
    const overflows =
      current.length + group.length > cap || chars + groupChars > maxChars || keys >= keyCap
    if (overflows && current.length > 0) {
      batches.push(current)
      current = []
      chars = 0
      keys = 0
    }
    current.push(...group)
    chars += groupChars
    keys++
  }

  if (current.length > 0) batches.push(current)
  return batches
}

const charsOf = <T>(items: readonly T[], sizeOf: (item: T) => number): number =>
  items.reduce((total, item) => total + sizeOf(item), 0)
