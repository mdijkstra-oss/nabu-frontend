import type { FileStore } from "~/lib/files/store"
import { collectAll } from "~/lib/files/collect"
import { ENTITY_ID_SUFFIX } from "~/lib/utils/entity-id"

export const extractEntityIdsFromSql = (sql: string, prefixes: string[]): string[] => {
  if (prefixes.length === 0) return []
  const escaped = prefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const pattern = new RegExp(`(?:${escaped.join("|")})-${ENTITY_ID_SUFFIX}(?![a-z0-9])`, "g")
  const matches = sql.match(pattern)
  if (!matches) return []
  return [...new Set(matches)]
}

export const collectAllEntityIds = (
  files: FileStore,
  extractors: ((raw: string) => string[])[]
): Set<string> => {
  const ids = extractors.flatMap((extract) => collectAll(files, extract))
  return new Set(ids)
}

export const validateSqlEntityReferences = (
  sql: string,
  prefixes: string[],
  knownIds: Set<string>
): string[] => {
  const found = extractEntityIdsFromSql(sql, prefixes)
  const unknown = found.filter((id) => !knownIds.has(id))
  return unknown.map((id) => `Unknown entity: ${id} — does it exist in your project?`)
}
