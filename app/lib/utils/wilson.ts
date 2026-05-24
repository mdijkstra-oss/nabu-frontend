const DEFAULT_Z = 1.28

const wilsonBound = (successes: number, total: number, z: number, sign: 1 | -1): number => {
  if (total === 0) return 0
  const p = successes / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const centre = p + z2 / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
  return (centre + sign * margin) / denominator
}

export const wilsonUpperBound = (successes: number, total: number, z = DEFAULT_Z): number =>
  wilsonBound(successes, total, z, 1)

export const wilsonLowerBound = (successes: number, total: number, z = DEFAULT_Z): number =>
  wilsonBound(successes, total, z, -1)
