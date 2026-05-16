const DEFAULT_Z = 1.28

export const wilsonUpperBound = (successes: number, total: number, z = DEFAULT_Z): number => {
  if (total === 0) return 0
  const p = successes / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const centre = p + z2 / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
  return (centre + margin) / denominator
}
