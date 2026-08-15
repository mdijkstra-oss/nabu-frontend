import { z } from "zod"
import type { CellType } from "~/lib/cells/types"
import { SQL_IDENTIFIER_PATTERN, UNUSABLE_IDENTIFIERS } from "~/lib/db/identifier"
import { isUsableColumnName } from "~/lib/db/ddl"

// Sync stamps a `file` column on every projected row, so a column keyed `file`
// would be unreachable in SQL. The rest are names the database or the language
// cannot hand back — see identifier.ts.
export const RESERVED_COLUMN_KEYS: readonly string[] = ["file", ...UNUSABLE_IDENTIFIERS]

export const COLUMN_KEY_PATTERN = SQL_IDENTIFIER_PATTERN

const isReservedColumnKey = (key: string): boolean => !isUsableColumnName(key)

const ColumnKeySchema = z
  .string()
  .regex(COLUMN_KEY_PATTERN, {
    message:
      "column key must be lowercase snake_case starting with a letter, e.g. `unit_price` (pattern ^[a-z][a-z0-9_]*$)",
  })
  .superRefine((key, ctx) => {
    if (!isReservedColumnKey(key)) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `\`${key}\` is a reserved column key — the database or the language cannot hand back a column of that name. Rename the column; its key is generated from the name.`,
    })
  })
  .describe(
    "The column's SQL identifier, generated once from `name` when the column is created and never changed afterwards — the projected table and every existing query and chart depend on it. Lowercase snake_case, unique within the block, and never `file` or a SQL keyword."
  )

const ColumnSchema = z.object({
  key: ColumnKeySchema,
  name: z
    .string()
    .min(1)
    .describe(
      "The header label shown to the reader. Free text, renameable at any time; renaming it moves nothing downstream because queries name the `key`."
    ),
  type: z
    .enum(["text", "number", "date"])
    .describe(
      "How this column's cell strings are read: `number` is the JSON number grammar, `date` is `YYYY-MM-DD`, `text` accepts anything. It is a parsing contract, not a storage format — changing it re-reads the cells and never rewrites them. A cell that fails its type shows as invalid and lands as NULL in SQL."
    ),
})

const uniqueKeyIssues = (columns: z.infer<typeof ColumnSchema>[], ctx: z.RefinementCtx): void => {
  const seen = new Set<string>()
  columns.forEach((column, index) => {
    if (seen.has(column.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "key"],
        message: `duplicate column key \`${column.key}\` — two columns cannot share one SQL name`,
      })
    }
    seen.add(column.key)
  })
}

const ColumnsSchema = z
  .array(ColumnSchema)
  .superRefine(uniqueKeyIssues)
  .describe(
    "The table's columns, in display order. May be empty — a table being edited down to no columns is still a table."
  )

const RowsSchema = z
  .array(z.record(z.string(), z.string()))
  .describe(
    "The table's rows, in display order. Each row maps column keys to cell values, and every value is a JSON string whatever the column's type (\"42\", not 42). A key missing from a row is a NULL cell; a key no column declares is an error."
  )

const CaptionSchema = z.object({
  label: z
    .string()
    .describe("Caption label displayed below the table, e.g. 'Monthly expenses by category'"),
})

export const TableSchema = z.object({
  id: z.string(),
  caption: CaptionSchema,
  columns: ColumnsSchema,
  rows: RowsSchema,
})

export type TableBlock = z.infer<typeof TableSchema>
export type TableColumn = TableBlock["columns"][number]
export type TableRow = TableBlock["rows"][number]

export type { CellType }

export const parseTable = (content: string): TableBlock | null => {
  try {
    const result = TableSchema.safeParse(JSON.parse(content))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
