import type { FileStore } from "~/lib/files/store"
import type { TableSchema, JsonSchema, DbError } from "./types"
import type { ProjectionConfig } from "./projection"
import type { DbConnection } from "./query"
import { extractRows } from "./extract"
import { escapeSqlString } from "./ddl"
import { ok, type Result } from "~/lib/fp/result"

export interface SyncPlan {
  deleted: string[]
  changed: string[]
}

export interface ProjectionWithSchema {
  config: ProjectionConfig
  jsonSchema: JsonSchema
  schemas: TableSchema[]
}

export const computeSyncPlan = (prev: FileStore, next: FileStore): SyncPlan => {
  const deleted = Object.keys(prev).filter((f) => !(f in next))
  const changed = Object.keys(next).filter((f) => next[f] !== prev[f])
  return { deleted, changed }
}

export const batchSyncPlan = (plan: SyncPlan, batchSize: number): SyncPlan[] => {
  if (plan.deleted.length === 0 && plan.changed.length === 0) return []

  const batches: SyncPlan[] = []

  const firstBatchChanged = plan.changed.slice(0, batchSize)
  batches.push({ deleted: plan.deleted, changed: firstBatchChanged })

  for (let i = batchSize; i < plan.changed.length; i += batchSize) {
    batches.push({ deleted: [], changed: plan.changed.slice(i, i + batchSize) })
  }

  return batches
}

const isAllowedFile = (filename: string, allowedFiles?: string[]): boolean =>
  !allowedFiles || allowedFiles.includes(filename)

const effectiveFile = (config: ProjectionConfig, filename: string): string =>
  config.fileMapper?.(filename) ?? filename

const isEmbeddingsFile = (filename: string): boolean => filename.endsWith(".embeddings.hidden.md")

const isEmbeddingsProjection = (config: ProjectionConfig): boolean =>
  config.fileMapper !== undefined

const buildProjectionDeleteSql = (projection: ProjectionWithSchema, filename: string): string => {
  const file = effectiveFile(projection.config, filename)
  return projection.schemas
    .map((s) => `DELETE FROM ${s.name} WHERE file = '${escapeSqlString(file)}';`)
    .join("\n")
}

interface TableInsert {
  columns: TableSchema["columns"]
  rows: Record<string, unknown>[]
}

const findTableSchema = (schemas: TableSchema[], tableName: string): TableSchema => {
  const schema = schemas.find((s) => s.name === tableName)
  if (!schema) throw new Error(`Unknown table in projection: ${tableName}`)
  return schema
}

const accumulateRows = (
  inserts: Map<string, TableInsert>,
  schemas: TableSchema[],
  tableName: string,
  jsonSchema: JsonSchema,
  block: unknown,
  file: string
): void => {
  const tableRows = extractRows(tableName, jsonSchema, block, file)
  for (const { table, rows } of tableRows) {
    if (rows.length === 0) continue
    const existing = inserts.get(table)
    if (existing) {
      existing.rows.push(...rows)
    } else {
      inserts.set(table, { columns: findTableSchema(schemas, table).columns, rows: [...rows] })
    }
  }
}

export const syncFiles = async (
  conn: DbConnection,
  plan: SyncPlan,
  files: FileStore,
  projections: ProjectionWithSchema[]
): Promise<Result<void, DbError>> => {
  const deleteStatements: string[] = []
  const inserts = new Map<string, TableInsert>()

  for (const filename of plan.deleted) {
    const embedded = isEmbeddingsFile(filename)
    for (const p of projections) {
      if (embedded !== isEmbeddingsProjection(p.config)) continue
      deleteStatements.push(buildProjectionDeleteSql(p, filename))
    }
  }

  for (const filename of plan.changed) {
    const embedded = isEmbeddingsFile(filename)
    for (const p of projections) {
      if (embedded !== isEmbeddingsProjection(p.config)) continue
      deleteStatements.push(buildProjectionDeleteSql(p, filename))
    }

    const raw = files[filename]

    for (const { config, jsonSchema, schemas } of projections) {
      if (embedded !== isEmbeddingsProjection(config)) continue
      if (!isAllowedFile(filename, config.allowedFiles)) continue

      const file = effectiveFile(config, filename)
      const blocks = config.blockParser(raw)

      for (const block of blocks) {
        accumulateRows(inserts, schemas, config.tableName, jsonSchema, block, file)
      }
    }
  }

  if (deleteStatements.length > 0) {
    const result = await conn.runSql(deleteStatements.join("\n"))
    if (!result.ok) return result
  }

  for (const [tableName, { columns, rows }] of inserts) {
    if (rows.length === 0) continue
    const result = await conn.insertTable(tableName, columns, rows)
    if (!result.ok) return result
  }

  return ok(undefined)
}
