import type { Settings } from "../schema"
import type { ValidationError } from "~/lib/data-blocks/validate"
import type { SearchEntry } from "~/domain/search/types"
import { validateSql } from "~/lib/search/semantic"
import { validateSqlEntityReferences } from "~/lib/data-blocks/ids"
import { getEntityPrefixes } from "~/lib/data-blocks/registry"
import { getFiles } from "~/lib/files/store"
import { getKnownEntityIds } from "~/domain/data-blocks/entity-ids"

const toSearchError = (msg: string): ValidationError => ({
  block: "json-settings",
  field: "searches",
  message: msg,
})

const validateEntry = (entry: SearchEntry): ValidationError[] => {
  const sqlResult = validateSql(entry.sql)
  const refErrors = validateSqlEntityReferences(
    entry.sql,
    getEntityPrefixes(),
    getKnownEntityIds(getFiles())
  )
  const errors: string[] = [...(sqlResult.ok ? [] : [sqlResult.error]), ...refErrors]
  return errors.map(toSearchError)
}

export const validateSearchSql = (parsed: Settings): ValidationError[] => {
  if (!parsed.searches) return []
  return parsed.searches.flatMap(validateEntry)
}
