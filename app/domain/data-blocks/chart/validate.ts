import type { ChartBlock } from "./schema"
import type { ValidationError } from "~/lib/data-blocks/validate"
import { getDatabase } from "~/domain/db/database"
import { executeQuery } from "~/lib/db/query"
import { validateSqlEntityReferences } from "~/lib/data-blocks/ids"
import { getEntityPrefixes } from "~/lib/data-blocks/registry"
import { getFiles } from "~/lib/files/store"
import { getKnownEntityIds } from "~/domain/data-blocks/entity-ids"
import { collectReferencedFields } from "~/lib/chart/template"
import { rejectSqlPatterns } from "~/lib/sql/reject"

const BLOCK = "json-chart"

const toQueryError = (message: string): ValidationError => ({
  block: BLOCK,
  field: "query",
  message,
})

const toSpecError = (message: string): ValidationError => ({
  block: BLOCK,
  field: "spec",
  message,
})

const findMissingColumns = (referenced: string[], available: Set<string>): string[] =>
  referenced.filter((field) => !available.has(field))

export const validateChartQuery = async (parsed: ChartBlock): Promise<ValidationError[]> => {
  const rejectErrors = rejectSqlPatterns(parsed.query)
  if (rejectErrors.length > 0) return rejectErrors.map(toQueryError)

  const db = getDatabase()
  if (!db) return []

  const refErrors = validateSqlEntityReferences(
    parsed.query,
    getEntityPrefixes(),
    getKnownEntityIds(getFiles())
  )
  if (refErrors.length > 0) return refErrors.map(toQueryError)

  const result = await executeQuery(db.instance, parsed.query)
  if (!result.ok) return [toQueryError(result.error.message)]

  const rows = result.value.rows as Record<string, unknown>[]
  if (rows.length === 0) return []

  const available = new Set(Object.keys(rows[0]))
  const referenced = collectReferencedFields(parsed.spec)
  const missing = findMissingColumns(referenced, available)
  if (missing.length === 0) return []

  return [
    toSpecError(
      `spec references columns not in query result: ${missing.join(", ")} (available: ${[...available].join(", ")})`
    ),
  ]
}
