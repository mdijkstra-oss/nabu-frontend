import {
  vectorFromArray,
  Table,
  Field,
  Float32,
  Utf8,
  Bool,
  Int32,
  List,
  DateDay,
  TimestampMillisecond,
} from "apache-arrow"
import type { DataType, Vector } from "apache-arrow"
import type { DbColumn, DuckDbType } from "./types"

const FLOAT_LIST = new List(Field.new({ name: "item", type: new Float32(), nullable: true }))
const STRING_LIST = new List(Field.new({ name: "item", type: new Utf8(), nullable: true }))

const ARROW_TYPES: Record<DuckDbType, DataType> = {
  VARCHAR: new Utf8(),
  DATE: new DateDay(),
  TIMESTAMP: new TimestampMillisecond(),
  BOOLEAN: new Bool(),
  INTEGER: new Int32(),
  "FLOAT[]": FLOAT_LIST,
  "VARCHAR[]": STRING_LIST,
}

const arrowType = (type: DuckDbType): DataType => {
  const t = ARROW_TYPES[type]
  if (!t) throw new Error(`Unsupported DuckDB type: ${type}`)
  return t
}

const isNullish = (raw: unknown): boolean => raw === null || raw === undefined || raw === ""

const toDate = (raw: unknown): Date | null => {
  if (isNullish(raw)) return null
  if (raw instanceof Date) return raw
  if (typeof raw === "string") {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

export const coerceValue = (type: DuckDbType, raw: unknown): unknown => {
  if (raw === null || raw === undefined) return null
  if (type === "DATE" || type === "TIMESTAMP") return toDate(raw)
  return raw
}

const columnValues = (col: DbColumn, rows: Record<string, unknown>[]): unknown[] =>
  rows.map((r) => coerceValue(col.type, r[col.name] ?? null))

export const rowsToArrowTable = (columns: DbColumn[], rows: Record<string, unknown>[]): Table => {
  const vectors: Record<string, Vector> = {}
  for (const col of columns) {
    vectors[col.name] = vectorFromArray(columnValues(col, rows), arrowType(col.type))
  }
  return new Table(vectors)
}
