import type { CellType } from "~/lib/cells/types"
import { generateColumnKey } from "./keys"
import type { TableBlock, TableColumn, TableRow } from "./schema"

export const addColumn = (block: TableBlock, index: number, name: string): TableBlock =>
  withColumns(
    block,
    insertAt(block.columns, index, {
      key: generateColumnKey(
        name,
        block.columns.map((c) => c.key)
      ),
      name,
      type: "text",
    })
  )

export const deleteColumn = (block: TableBlock, key: string): TableBlock => ({
  ...block,
  columns: block.columns.filter((column) => column.key !== key),
  rows: block.rows.map(({ [key]: _dropped, ...rest }) => rest),
})

export const renameColumn = (block: TableBlock, key: string, name: string): TableBlock =>
  mapColumn(block, key, (column) => ({ ...column, name }))

export const setColumnType = (block: TableBlock, key: string, type: CellType): TableBlock =>
  mapColumn(block, key, (column) => ({ ...column, type }))

export const addRow = (block: TableBlock, index: number): TableBlock => ({
  ...block,
  rows: insertAt(block.rows, index, Object.fromEntries(block.columns.map((c) => [c.key, ""]))),
})

export const deleteRow = (block: TableBlock, rowIndex: number): TableBlock => ({
  ...block,
  rows: block.rows.filter((_, index) => index !== rowIndex),
})

export const setCell = (
  block: TableBlock,
  rowIndex: number,
  key: string,
  value: string
): TableBlock => mapRow(block, rowIndex, (row) => ({ ...row, [key]: value }))

const withColumns = (block: TableBlock, columns: TableColumn[]): TableBlock => ({
  ...block,
  columns,
})

const mapColumn = (
  block: TableBlock,
  key: string,
  change: (column: TableColumn) => TableColumn
): TableBlock =>
  withColumns(
    block,
    block.columns.map((column) => (column.key === key ? change(column) : column))
  )

const mapRow = (
  block: TableBlock,
  rowIndex: number,
  change: (row: TableRow) => TableRow
): TableBlock => ({
  ...block,
  rows: block.rows.map((row, index) => (index === rowIndex ? change(row) : row)),
})

const insertAt = <T>(items: readonly T[], index: number, item: T): T[] => [
  ...items.slice(0, index),
  item,
  ...items.slice(index),
]
