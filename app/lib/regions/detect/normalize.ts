import type { RegionValueType } from "~/lib/regions/kinds/registry"

export type ValueNormalizer = (raw: string) => string | null

const SURROUNDING_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

const normalizeString: ValueNormalizer = (raw) => {
  const folded = raw.trim().replace(/\s+/g, " ").toLowerCase().replace(SURROUNDING_PUNCTUATION, "")
  return folded.length > 0 ? folded : null
}

const ISO_8601 =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/

// Feb 30 parses: ECMAScript rolls a calendar overflow forward instead of rejecting it,
// so a real instant is no evidence that the model named a real day.
const isRealCalendarDay = (instant: Date, date: string): boolean =>
  instant.toISOString().startsWith(date)

// ECMAScript reads a date-only ISO string as UTC but a date-time string carrying no zone
// as local time, so the zone is always made explicit before parsing.
const normalizeDatetime: ValueNormalizer = (raw) => {
  const match = ISO_8601.exec(raw.trim())
  if (!match) return null

  const [, date, time, zone] = match
  const instant = new Date(time ? `${date}T${time}${zone ?? "Z"}` : `${date}T00:00:00.000Z`)
  if (Number.isNaN(instant.getTime())) return null
  if (!zone && !isRealCalendarDay(instant, date)) return null
  return instant.toISOString()
}

export const valueNormalizers: Record<RegionValueType, ValueNormalizer> = {
  string: normalizeString,
  datetime: normalizeDatetime,
}

export const normalizeValue = (valueType: RegionValueType, raw: string): string | null =>
  valueNormalizers[valueType](raw)
