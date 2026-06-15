import { ENTITY_ID_SUFFIX } from "~/lib/utils/entity-id"

const buildEntityPattern = (prefixes: string[]): RegExp =>
  new RegExp(`^(${prefixes.join("|")})-${ENTITY_ID_SUFFIX}$`)

const buildEntityScanPattern = (prefixes: string[]): RegExp =>
  new RegExp(`(?<![\\w-])(?:${prefixes.join("|")})-${ENTITY_ID_SUFFIX}`, "g")

export const extractEntityIdsFromRows = (
  rows: Record<string, unknown>[],
  prefixes: string[]
): string[] => {
  if (prefixes.length === 0) return []
  const pattern = buildEntityPattern(prefixes)
  const ids = new Set<string>()
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === "string" && pattern.test(value)) {
        ids.add(value)
      }
    }
  }
  return [...ids]
}

export const extractEntityIdsFromText = (text: string, prefixes: string[]): string[] => {
  if (prefixes.length === 0) return []
  const pattern = buildEntityScanPattern(prefixes)
  return [...new Set(Array.from(text.matchAll(pattern), (m) => m[0]))]
}
