import { tableFailures } from "~/lib/cells/parse"
import type { BlockTypeConfig } from "~/lib/data-blocks/definition"
import type { ValidationError } from "~/lib/data-blocks/validate"
import { TableSchema, type TableBlock, type TableRow } from "./schema"

const BLOCK = "json-table"

const cellField = (row: number, key: string): string => `rows.${row}.${key}`

const declaredKeys = (parsed: TableBlock): string[] => parsed.columns.map((column) => column.key)

const knownKeyList = (keys: string[]): string =>
  keys.length === 0 ? "none — the table declares no columns" : keys.join(", ")

const strayKeys = (row: TableRow, declared: Set<string>): string[] =>
  Object.keys(row).filter((key) => !declared.has(key))

const strayKeyErrors = (parsed: TableBlock): ValidationError[] => {
  const keys = declaredKeys(parsed)
  const declared = new Set(keys)
  return parsed.rows.flatMap((row, index) =>
    strayKeys(row, declared).map((key) => ({
      block: BLOCK,
      field: cellField(index, key),
      message: `no column declares the key \`${key}\`. Declared column keys: ${knownKeyList(keys)}. Add the column or remove the key from the row.`,
      received: JSON.stringify(row[key]),
    }))
  )
}

const cellParseErrors = (parsed: TableBlock): ValidationError[] => {
  const typeOf = new Map(parsed.columns.map((column) => [column.key, column.type]))
  return tableFailures(parsed.columns, parsed.rows).map(({ row, column }) => ({
    block: BLOCK,
    field: cellField(row, column),
    message: `cell does not parse as \`${typeOf.get(column)}\`, the type column \`${column}\` declares. Fix the value or change the column's type.`,
    received: JSON.stringify(parsed.rows[row]?.[column]),
  }))
}

const validateTable = async (parsed: TableBlock): Promise<ValidationError[]> => [
  ...strayKeyErrors(parsed),
  ...cellParseErrors(parsed),
]

export const jsonTable: BlockTypeConfig<TableBlock> = {
  schema: () => TableSchema,
  readonly: [],
  immutable: {
    id: 'Field "id" is immutable',
  },
  constraints: [
    "To rename a column, change its `name` only — never its `key`. The key is the column's SQL name, and the projected table and every existing query and chart depend on it.",
    "To delete a column, remove its entry from `columns` and remove its key from every row.",
    "A new column gets a snake_case `key` generated from its `name` (lowercase, underscores, deduped with numeric suffixes like `amount_2`); the key never changes afterwards. `file` is reserved.",
    'Every cell value is a JSON string, whatever the column\'s type ("42", not 42); a key missing from a row is a NULL cell.',
    "Each table is queryable as its own SQL table named table_<id>, the block id with hyphens as underscores; query it to see current columns and data rather than assuming.",
  ],
  renderer: "table",
  singleton: false,
  projectedPerBlock: true,
  labelKey: "caption.label",
  captionType: "Table",
  idPaths: [{ path: "id", prefix: "table" }],
  asyncValidate: validateTable,
}
