// Counted with multiplicity: a value appearing twice on one side and once on the other is
// shared once, not twice.
export const sharedCount = <T>(left: readonly T[], right: readonly T[]): number => {
  const unclaimed = new Map<T, number>()
  for (const value of left) unclaimed.set(value, (unclaimed.get(value) ?? 0) + 1)

  let shared = 0
  for (const value of right) {
    const remaining = unclaimed.get(value) ?? 0
    if (remaining === 0) continue
    unclaimed.set(value, remaining - 1)
    shared++
  }
  return shared
}
