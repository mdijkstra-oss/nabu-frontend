import { utcTicks } from "d3-time"

export const TIME_TICK_TARGET = 8

const finiteValues = (values: readonly (string | number)[]): number[] =>
  values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))

// Round time boundaries rather than the values themselves: a tick per bucket
// crowds the axis and, worse, hides that months between two buckets carry no
// rows at all.
export const timeAxisTicks = (
  values: readonly (string | number)[],
  target: number = TIME_TICK_TARGET
): number[] => {
  const finite = finiteValues(values)
  if (finite.length === 0) return []
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  if (min === max) return [min]
  const ticks = utcTicks(new Date(min), new Date(max), target).map((date) => date.getTime())
  return ticks.length === 0 ? [min, max] : ticks
}

export const timeAxisDomain = (
  values: readonly (string | number)[]
): [number, number] | undefined => {
  const finite = finiteValues(values)
  if (finite.length === 0) return undefined
  return [Math.min(...finite), Math.max(...finite)]
}

const isInteger = (value: unknown): boolean => typeof value !== "number" || Number.isInteger(value)

const seriesValues = (
  rows: readonly Record<string, unknown>[],
  keys: readonly string[]
): number[] =>
  rows.flatMap((row) =>
    keys.map((key) => row[key]).filter((value): value is number => typeof value === "number")
  )

// Recharts halves a 0–2 domain into 0.5 steps, which reads as a measurement
// between two counts. Whole numbers stay whole.
export const allValuesAreIntegers = (
  rows: readonly Record<string, unknown>[],
  keys: readonly string[]
): boolean => rows.every((row) => keys.every((key) => isInteger(row[key])))

// Recharts asks for five ticks whatever the data, so a 0-2 range gets an axis that
// reaches 4 and wastes half the plot. A short whole-numbered range gets one tick per
// value instead.
export const wholeNumberTickCount = (
  rows: readonly Record<string, unknown>[],
  keys: readonly string[],
  fallback = 5
): number => {
  const values = seriesValues(rows, keys)
  if (values.length === 0) return fallback
  const max = Math.max(...values)
  if (max <= 0) return 2
  return max + 1 < fallback ? max + 1 : fallback
}
