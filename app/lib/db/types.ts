import type { AsyncDuckDB } from "@duckdb/duckdb-wasm"
import type { Result } from "~/lib/fp/result"

export interface JsonSchema {
  type?: string
  format?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: string[]
}

export type DuckDbType =
  | "VARCHAR"
  | "DATE"
  | "TIMESTAMP"
  | "BOOLEAN"
  | "INTEGER"
  | "DOUBLE"
  | "VARCHAR[]"
  | "FLOAT[]"

export interface DbColumn {
  name: string
  type: DuckDbType
  nullable: boolean
}

export interface TableSchema {
  name: string
  columns: DbColumn[]
}

export interface DbError {
  type: "init" | "schema" | "query"
  message: string
  cause?: unknown
}

export interface QueryResult<T> {
  rows: T[]
  rowCount: number
}

export interface Database {
  instance: AsyncDuckDB
  query: <T = unknown>(sql: string) => Promise<Result<QueryResult<T>, DbError>>
}
