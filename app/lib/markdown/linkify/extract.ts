import { getEntityPrefixes } from "~/lib/data-blocks/registry"
import { ENTITY_ID_SUFFIX } from "~/lib/utils/entity-id"

const buildCandidatePattern = (prefixes: string[]): RegExp =>
  new RegExp(`(${prefixes.join("|")})-${ENTITY_ID_SUFFIX}[a-zA-Z0-9_-]*`, "g")

export const extractEntityIdCandidates = (text: string): string[] => {
  const pattern = buildCandidatePattern(getEntityPrefixes())
  const matches = text.match(pattern)
  return matches ? [...new Set(matches)] : []
}
