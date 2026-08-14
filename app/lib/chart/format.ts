import { format as d3Format } from "d3-format"
import { timeFormat as d3TimeFormat } from "d3-time-format"

const TIME_DIRECTIVE = /%[a-zA-Z]/

const isTimeFormat = (format: string): boolean => TIME_DIRECTIVE.test(format)

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  if (typeof value === "number") {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof value === "string") {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

export const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return isNaN(value) ? null : value
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string") {
    const n = Number(value)
    return isNaN(n) ? null : n
  }
  return null
}

const formatTime = (value: unknown, pattern: string): string => {
  const date = toDate(value)
  if (!date) return ""
  return d3TimeFormat(pattern)(date)
}

const formatNumber = (value: unknown, pattern: string): string => {
  const number = toNumber(value)
  if (number === null) return ""
  return d3Format(pattern)(number)
}

export const formatValue = (value: unknown, format: string): string =>
  isTimeFormat(format) ? formatTime(value, format) : formatNumber(value, format)
