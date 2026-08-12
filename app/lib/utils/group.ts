export const groupBy = <T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const existing = groups.get(keyOf(item))
    if (existing) existing.push(item)
    else groups.set(keyOf(item), [item])
  }
  return groups
}

export const nearestTo = <T>(
  candidates: readonly T[],
  target: number,
  positionOf: (item: T) => number
): T | undefined =>
  candidates.reduce<T | undefined>(
    (best, item) =>
      best === undefined ||
      Math.abs(positionOf(item) - target) < Math.abs(positionOf(best) - target)
        ? item
        : best,
    undefined
  )
