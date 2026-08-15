import { subscribe, getFiles, type FileStore } from "~/lib/files/store"
import { debounce } from "~/lib/utils/debounce"
import { initializeDatabase } from "~/lib/db/init"
import { computeSyncPlan, syncFiles, batchSyncPlan, type ProjectionWithSchema } from "~/lib/db/sync"
import { executeWithConnection } from "~/lib/db/query"
import {
  jsonSchemaToTableProjection,
  tableSchemaToDdl,
  tableSchemaToDescribe,
  filterHiddenColumns,
} from "~/lib/db/ddl"
import { getProjections, toJsonSchema } from "./projections"
import { buildClaimSet, syncDocTables, type TrackedTables } from "./doc-tables"
import type { Database, TableSchema } from "~/lib/db/types"

const buildProjectionsWithSchemas = (): ProjectionWithSchema[] =>
  getProjections().map((config) => {
    const jsonSchema = toJsonSchema(config)
    const { schemas } = jsonSchemaToTableProjection(config.tableName, jsonSchema)
    return { config, jsonSchema, schemas }
  })

const generateDdl = (withSchemas: ProjectionWithSchema[]): string =>
  withSchemas.flatMap((p) => p.schemas.map(tableSchemaToDdl)).join("\n\n")

export type OnDbSyncProgress = (processed: number, total: number) => void

const DB_SYNC_BATCH_SIZE = 20

export const waitForDatabase = (): Promise<void> => dbReadyPromise

let database: Database | null = null
let previousFiles: FileStore = {}
// DuckDB here is in-memory and rebuilt every app start, and the first sync after
// start treats every file as changed, so this map is rebuilt by the same pass
// that rebuilds the tables. There is no persistence for it to drift from.
const trackedDocTables: TrackedTables = new Map()
let initializing = false
let syncRevision = 0
const syncListeners = new Set<() => void>()

export const subscribeSyncRevision = (listener: () => void): (() => void) => {
  syncListeners.add(listener)
  return () => syncListeners.delete(listener)
}

export const getSyncRevision = (): number => syncRevision
let dbReadyResolve: (() => void) | null = null
const dbReadyPromise = new Promise<void>((r) => {
  dbReadyResolve = r
})
const batchItemCount = (batch: { deleted: string[]; changed: string[] }): number =>
  batch.deleted.length + batch.changed.length

const runSync = async (
  db: Database,
  withSchemas: ProjectionWithSchema[],
  onProgress?: OnDbSyncProgress
): Promise<void> => {
  const currentFiles = getFiles()
  const plan = computeSyncPlan(previousFiles, currentFiles)

  if (plan.deleted.length === 0 && plan.changed.length === 0) return

  const total = plan.deleted.length + plan.changed.length
  let processed = 0
  const batches = batchSyncPlan(plan, DB_SYNC_BATCH_SIZE)
  // Built from the whole plan before any batch runs: a rename's delete and its
  // changed half can land in different batches, and the claim is what stops the
  // first batch dropping a table the later one is about to create.
  const claims = buildClaimSet(plan, currentFiles)

  await executeWithConnection(db.instance, async (conn) => {
    for (const batch of batches) {
      const result = await syncFiles(conn, batch, currentFiles, withSchemas)
      if (!result.ok) {
        console.error("[db] sync failed:", result.error)
        return
      }
      await syncDocTables(conn, batch, currentFiles, claims, trackedDocTables)
      processed += batchItemCount(batch)
      onProgress?.(processed, total)
    }
  })

  previousFiles = currentFiles
  syncRevision++
  syncListeners.forEach((listener) => listener())
}

export const startDatabase = async (onProgress?: OnDbSyncProgress): Promise<void> => {
  if (database || initializing) return
  initializing = true

  const withSchemas = buildProjectionsWithSchemas()
  const ddl = generateDdl(withSchemas)

  const result = await initializeDatabase(ddl)

  if (!result.ok) {
    console.error("[db] init failed:", result.error)
    return
  }

  database = result.value

  await runSync(database, withSchemas, onProgress)
  dbReadyResolve?.()

  if (typeof window !== "undefined") {
    ;(window as unknown as Record<string, unknown>).query = async (sql: string) => {
      if (!database) return { error: "Database not initialized" }
      const queryResult = await database.query(sql)
      if (!queryResult.ok) return { error: queryResult.error }
      return queryResult.value.rows
    }
  }
}

export const syncOnce = async (): Promise<void> => {
  if (!database) return
  const withSchemas = buildProjectionsWithSchemas()
  await runSync(database, withSchemas)
}

export const startBackgroundSync = (): void => {
  if (!database) return
  const withSchemas = buildProjectionsWithSchemas()

  const debouncedSync = debounce(() => {
    if (database) runSync(database, withSchemas)
  }, 200)

  subscribe(debouncedSync)
}

export const getDatabase = (): Database | null => database

const isExposed = (p: ProjectionWithSchema): boolean => p.config.expose !== false

const collectExposedSchemas = (withSchemas: ProjectionWithSchema[]): TableSchema[] =>
  withSchemas.flatMap((p) => {
    const hidden = p.config.hiddenColumns ?? []
    return hidden.length > 0 ? p.schemas.map((s) => filterHiddenColumns(s, hidden)) : p.schemas
  })

let cachedSchema: string | null = null

export const getDatabaseSchema = (): string => {
  if (cachedSchema) return cachedSchema
  const exposed = buildProjectionsWithSchemas().filter(isExposed)
  cachedSchema = collectExposedSchemas(exposed).map(tableSchemaToDescribe).join("\n\n")
  return cachedSchema
}
