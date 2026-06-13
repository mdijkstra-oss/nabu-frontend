import { getEntityPrefixes } from "~/lib/data-blocks/registry"

const buildPattern = (prefixes: string[]): RegExp =>
  new RegExp(`\\b(${prefixes.join("|")})_([a-z0-9]{8})\\b`, "gi")

export const normalizeEntityIdSeparators = (text: string): string => {
  if (!text.includes("_")) return text
  const prefixes = getEntityPrefixes()
  if (prefixes.length === 0) return text
  return text.replace(buildPattern(prefixes), "$1-$2")
}
