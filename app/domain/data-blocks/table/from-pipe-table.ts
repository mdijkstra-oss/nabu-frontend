import { inferColumnType } from "~/lib/cells/infer"
import { generateShortId } from "~/lib/data-blocks/uuid"
import { getIdPaths } from "~/lib/data-blocks/registry"
import { generateColumnKeys } from "./keys"
import type { TableBlock } from "./schema"

// gfm's alignment row carries no data the block has a field for, so no path
// hands it over: a table is its header cells and its body rows.
export interface PipeTable {
  header: string[]
  rows: string[][]
}

export const pipeTableToBlock = (table: PipeTable): TableBlock => {
  const names = table.header.map(headerName)
  const keys = generateColumnKeys(names)
  const squared = table.rows.map((row) => squareOff(row, names.length))

  return {
    id: generateTableId(),
    caption: { label: "" },
    columns: keys.map((key, index) => ({
      key,
      name: names[index],
      type: inferColumnType(squared.map((row) => row[index])),
    })),
    rows: squared.map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index]]))),
  }
}

const generateTableId = (): string => `${getIdPaths("json-table")[0].prefix}-${generateShortId()}`

const headerName = (cell: string, index: number): string =>
  cell.trim() === "" ? `column_${index + 1}` : cell

const squareOff = (row: string[], width: number): string[] =>
  Array.from({ length: width }, (_, index) => row[index] ?? "")
