import { getEntityPrefixes } from "~/lib/data-blocks/registry"
import { ENTITY_ID_SUFFIX } from "~/lib/utils/entity-id"

const buildPattern = (prefixes: string[]): RegExp =>
  new RegExp(`\\b(${prefixes.join("|")})_(${ENTITY_ID_SUFFIX})\\b`, "gi")

export const normalizeEntityIdSeparators = (text: string): string => {
  if (!text.includes("_")) return text
  const prefixes = getEntityPrefixes()
  if (prefixes.length === 0) return text
  return text.replace(buildPattern(prefixes), "$1-$2")
}
