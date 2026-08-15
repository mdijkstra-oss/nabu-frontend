import { parseCell } from "./parse"
import type { CellType } from "./types"

export const inferColumnType = (values: readonly (string | undefined)[]): CellType => {
  const filled = values.filter((raw) => parseCell(raw, "text").kind !== "empty")
  if (filled.length === 0) return "text"

  const numbers = countValid(filled, "number")
  const dates = countValid(filled, "date")
  const numberWins = isMajority(numbers, filled.length)
  const dateWins = isMajority(dates, filled.length)

  if (numberWins && dateWins) return dates > numbers ? "date" : "number"
  if (numberWins) return "number"
  if (dateWins) return "date"
  return "text"
}

const countValid = (values: readonly (string | undefined)[], type: CellType): number =>
  values.filter((raw) => parseCell(raw, type).kind === "valid").length

const isMajority = (count: number, total: number): boolean => count * 2 > total
