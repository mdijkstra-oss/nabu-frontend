import { toSnakeCase } from "~/lib/db/naming"
import { RESERVED_COLUMN_KEYS } from "./schema"

export const generateColumnKey = (name: string, existingKeys: readonly string[]): string => {
  const taken = new Set([...RESERVED_COLUMN_KEYS, ...existingKeys])
  const base = toKeyBase(name)
  if (!taken.has(base)) return base

  let suffix = 2
  while (taken.has(`${base}_${suffix}`)) suffix++
  return `${base}_${suffix}`
}

export const generateColumnKeys = (names: readonly string[]): string[] =>
  names.reduce<string[]>((keys, name) => [...keys, generateColumnKey(name, keys)], [])

const toUnderscores = (name: string): string =>
  name.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")

const toKeyBase = (name: string): string => {
  const cleaned = toUnderscores(toSnakeCase(name))
  if (cleaned === "") return "col"
  return /^[0-9]/.test(cleaned) ? `col_${cleaned}` : cleaned
}
