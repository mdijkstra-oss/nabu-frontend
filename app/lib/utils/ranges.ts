export const mergeOverlapping = <T>(
  items: T[],
  getStart: (item: T) => number,
  getEnd: (item: T) => number,
  merge: (a: T, b: T) => T
): T[] => {
  if (items.length <= 1) return items
  const sorted = [...items].sort((a, b) => getStart(a) - getStart(b))
  const merged: T[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = sorted[i]
    if (getStart(curr) <= getEnd(prev)) {
      merged[merged.length - 1] = merge(prev, curr)
    } else {
      merged.push(curr)
    }
  }
  return merged
}
