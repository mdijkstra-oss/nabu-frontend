import { cellAt, parseCell } from "~/lib/cells/parse"
import type { CellType } from "~/lib/cells/types"
import { getBlocksStrict } from "~/lib/data-blocks/query"
import { getPerBlockProjectedConfigs } from "~/lib/data-blocks/registry"
import {
  dropTableDdl,
  fileColumn,
  isUsableColumnName,
  tableCommentDdl,
  tableSchemaToDdl,
} from "~/lib/db/ddl"
import { isUsableIdentifier } from "~/lib/db/identifier"
import type { DbConnection } from "~/lib/db/query"
import type { SyncPlan } from "~/lib/db/sync"
import type { DbColumn, DbError, DuckDbType, TableSchema as DbTableSchema } from "~/lib/db/types"
import type { FileStore } from "~/lib/files/store"
import { err, ok, type Result } from "~/lib/fp/result"
import type { TableBlock, TableColumn } from "~/domain/data-blocks/table/schema"

export interface DocTable {
  name: string
  file: string
  schema: DbTableSchema
  rows: Record<string, unknown>[]
  comment: string
}

export interface RefusedBlock {
  blockId: string
  name: string
  reason: string
}

export interface CollectedDocTables {
  tables: DocTable[]
  refused: RefusedBlock[]
}

export type ClaimSet = Map<string, string>

export type TrackedTables = Map<string, Set<string>>

export const deriveTableName = (blockId: string): string => blockId.replace(/-/g, "_")

// A table name and a column name are different rules: `file` is a fine table
// name and an unusable column one, because sync stamps that column itself.
export const isValidIdentifier = (name: string): boolean => isUsableIdentifier(name)

export const tableComment = (caption: string, file: string, failingCells: number): string => {
  const head = caption ? `${caption} (${file})` : file
  if (failingCells === 0) return head
  const tail =
    failingCells === 1
      ? "1 cell fails its column type"
      : `${failingCells} cells fail their column type`
  return `${head} — ${tail}`
}

export const toDocTable = (block: TableBlock, file: string): Result<DocTable, RefusedBlock> => {
  const name = deriveTableName(block.id)
  if (!isUsableIdentifier(name)) {
    return err({ blockId: block.id, name, reason: `invalid table name "${name}"` })
  }

  const unusable = block.columns.find((column) => !isUsableColumnName(column.key))
  if (unusable) {
    return err({ blockId: block.id, name, reason: `invalid column key "${unusable.key}"` })
  }

  const { rows, failingCells } = projectRows(block, file)

  return ok({
    name,
    file,
    schema: { name, columns: [fileColumn, ...block.columns.map(toDbColumn)] },
    rows,
    comment: tableComment(block.caption.label, file, failingCells),
  })
}

export const collectDocTables = (raw: string, file: string): CollectedDocTables => {
  const tables: DocTable[] = []
  const refused: RefusedBlock[] = []

  for (const block of parseTableBlocks(raw)) {
    const projected = toDocTable(block, file)
    if (projected.ok) tables.push(projected.value)
    else refused.push(projected.error)
  }

  return { tables, refused }
}

export const buildClaimSet = (plan: SyncPlan, files: FileStore): ClaimSet => {
  const claims: ClaimSet = new Map()

  for (const file of plan.changed) {
    for (const table of collectDocTables(files[file] ?? "", file).tables) {
      claims.set(table.name, file)
    }
  }

  return claims
}

export const syncDocTables = async (
  conn: DbConnection,
  batch: SyncPlan,
  files: FileStore,
  claims: ClaimSet,
  tracked: TrackedTables
): Promise<void> => {
  const departed = new Set<string>()
  const broken = new Set<string>()

  for (const file of batch.deleted) {
    for (const name of untrack(tracked, file)) departed.add(name)
  }

  for (const file of batch.changed) {
    const previous = untrack(tracked, file)
    const { tables, refused } = collectDocTables(files[file] ?? "", file)

    for (const refusal of refused) {
      console.error(`[db] doc table skipped — ${refusal.reason} (block ${refusal.blockId})`)
      if (isUsableIdentifier(refusal.name)) broken.add(refusal.name)
    }

    const built = new Set<string>()
    for (const table of tables) {
      // Two files in one pass can derive the same name. Only the winner builds
      // and is tracked: the loser building too would leave both files recorded
      // as owners, and the loser's stale entry would later drop the winner's
      // live table. An unclaimed name means no file contested it.
      if (claims.has(table.name) && claims.get(table.name) !== file) continue
      const result = await buildTable(conn, table)
      if (result.ok) {
        track(tracked, file, table.name)
        built.add(table.name)
      } else {
        console.error(`[db] doc table ${table.name} failed to build:`, result.error.message)
        broken.add(table.name)
      }
    }

    for (const name of previous) {
      if (!built.has(name)) departed.add(name)
    }
  }

  const abandoned = [...departed].filter((name) => !claims.has(name))
  for (const name of new Set([...broken, ...abandoned])) {
    await conn.runSql(dropTableDdl(name))
  }
}

const CELL_TYPE_TO_DUCKDB: Record<CellType, DuckDbType> = {
  text: "VARCHAR",
  number: "DOUBLE",
  date: "DATE",
}

const toDbColumn = (column: TableColumn): DbColumn => ({
  name: column.key,
  type: CELL_TYPE_TO_DUCKDB[column.type],
  nullable: true,
})

interface ProjectedRows {
  rows: Record<string, unknown>[]
  failingCells: number
}

const projectRows = (block: TableBlock, file: string): ProjectedRows => {
  if (block.columns.length === 0) return { rows: [], failingCells: 0 }

  let failingCells = 0

  const rows = block.rows.map((row) => {
    const projected: Record<string, unknown> = { file }
    for (const column of block.columns) {
      const verdict = parseCell(cellAt(row, column.key), column.type)
      if (verdict.kind === "invalid") failingCells++
      projected[column.key] = verdict.kind === "valid" ? verdict.value : null
    }
    return projected
  })

  return { rows, failingCells }
}

const parseTableBlocks = (raw: string): TableBlock[] =>
  getPerBlockProjectedConfigs().flatMap(([language, config]) =>
    getBlocksStrict<TableBlock>(raw, language, config.schema() as never)
  )

const buildTable = async (conn: DbConnection, table: DocTable): Promise<Result<void, DbError>> => {
  const created = await conn.runSql(tableSchemaToDdl(table.schema))
  if (!created.ok) return created

  const commented = await conn.runSql(tableCommentDdl(table.name, table.comment))
  if (!commented.ok) return commented

  if (table.rows.length === 0) return ok(undefined)
  return conn.insertTable(table.name, table.schema.columns, table.rows)
}

const untrack = (tracked: TrackedTables, file: string): Set<string> => {
  const names = tracked.get(file) ?? new Set<string>()
  tracked.delete(file)
  return names
}

const track = (tracked: TrackedTables, file: string, name: string): void => {
  const names = tracked.get(file) ?? new Set<string>()
  names.add(name)
  tracked.set(file, names)
}
