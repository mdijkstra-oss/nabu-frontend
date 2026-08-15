export type CellType = "text" | "number" | "date"

// text keeps the raw string, number a finite double, date the canonical
// YYYY-MM-DD string — never a Date, so no timezone sits between the grid, the
// projection and validation.
export type CellVerdict =
  | { kind: "empty" }
  | { kind: "valid"; value: string | number }
  | { kind: "invalid" }

export interface CellColumn {
  key: string
  type: CellType
}

export interface TableFailure {
  row: number
  column: string
}
