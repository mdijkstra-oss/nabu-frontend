import type { CellColumn, CellType, CellVerdict, TableFailure } from "./types"

export const parseCell = (raw: string | undefined, type: CellType): CellVerdict => {
  if (raw === undefined) return EMPTY
  const trimmed = trimAscii(raw)
  if (trimmed === "") return EMPTY
  if (type === "text") return { kind: "valid", value: raw }
  return type === "number" ? parseNumber(trimmed) : parseDate(trimmed)
}

// A bare `row[key]` is not "the key is missing from the row": a key naming an
// inherited property resolves off the prototype chain and hands a function to
// code expecting a cell. Every reader of a row goes through here.
export const cellAt = (row: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(row, key) ? row[key] : undefined

export const tableFailures = (
  columns: readonly CellColumn[],
  rows: readonly Record<string, string>[]
): TableFailure[] =>
  rows.flatMap((row, index) =>
    columns
      .filter((column) => parseCell(cellAt(row, column.key), column.type).kind === "invalid")
      .map((column) => ({ row: index, column: column.key }))
  )

const EMPTY: CellVerdict = { kind: "empty" }
const INVALID: CellVerdict = { kind: "invalid" }

const ASCII_WHITESPACE = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g

const trimAscii = (raw: string): string => raw.replace(ASCII_WHITESPACE, "")

// The JSON number grammar (RFC 8259 section 6), which is narrower than
// JavaScript's own numeric literals: no leading +, no hex, no leading zeros.
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/

const parseNumber = (trimmed: string): CellVerdict => {
  if (!JSON_NUMBER.test(trimmed)) return INVALID
  const value = Number(trimmed)
  return Number.isFinite(value) ? { kind: "valid", value } : INVALID
}

const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

const daysInMonth = (year: number, month: number): number =>
  month === 2 && isLeapYear(year) ? 29 : DAYS_PER_MONTH[month - 1]

const parseDate = (trimmed: string): CellVerdict => {
  const match = ISO_DATE.exec(trimmed)
  if (!match) return INVALID
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return INVALID
  if (day < 1 || day > daysInMonth(year, month)) return INVALID
  return { kind: "valid", value: trimmed }
}
