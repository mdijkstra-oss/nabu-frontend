import type { z } from "zod"
import { findSingletonBlock, findBlocksByLanguage } from "~/lib/data-blocks/parse"
import { tryParseJson } from "~/lib/data-blocks/json"
import { stripPendingRefs } from "~/lib/files/pending-refs"
import { createCappedCache } from "~/lib/utils/cache"
import { decorateParsed } from "~/lib/regions/decorate"

export const recoverArrayItems = <T>(
  json: Record<string, unknown>,
  schema: z.ZodType<T>
): T | null => {
  const arrayKeys = Object.keys(json).filter((k) => Array.isArray(json[k]))
  if (arrayKeys.length === 0) return null

  const base: Record<string, unknown> = { ...json }
  for (const key of arrayKeys) base[key] = []

  const baseResult = schema.safeParse(base)
  if (!baseResult.success) return null

  const recovered: Record<string, unknown> = { ...json }
  let dropped = false
  for (const key of arrayKeys) {
    const items = json[key] as unknown[]
    recovered[key] = items.filter((item, i) => {
      const result = schema.safeParse({ ...base, [key]: [item] })
      if (!result.success) {
        console.warn(
          `[data-block] Dropped invalid item at ${key}[${i}]:`,
          result.error.issues[0]?.message,
          "— got:",
          JSON.stringify(item)
        )
        dropped = true
        return false
      }
      return true
    })
  }

  if (!dropped) return null

  const finalResult = schema.safeParse(recovered)
  return finalResult.success ? finalResult.data : null
}

const isRecoverableObject = (json: unknown): json is Record<string, unknown> =>
  typeof json === "object" && json !== null && !Array.isArray(json)

const cache = createCappedCache<string, unknown>(3000)

const BOUNDARY_COMMENT = /^\/\/ (?:start|end) json-\S+.*$/

const stripBoundaryLines = (content: string): string =>
  content
    .split("\n")
    .filter((line) => !BOUNDARY_COMMENT.test(line.trim()))
    .join("\n")

const cacheKey = (language: string, content: string): string => `${language}:${content}`

const parseWithCache = <T>(language: string, content: string, schema: z.ZodType<T>): T | null => {
  const key = cacheKey(language, content)

  if (cache.has(key)) return cache.get(key) as T | null

  try {
    const json = JSON.parse(stripPendingRefs(stripBoundaryLines(content)))
    const result = schema.safeParse(json)
    if (result.success) {
      cache.set(key, result.data)
      return result.data
    }

    if (isRecoverableObject(json)) {
      const recovered = recoverArrayItems(json, schema)
      cache.set(key, recovered)
      return recovered
    }

    cache.set(key, null)
    return null
  } catch {
    cache.set(key, null)
    return null
  }
}

export const getBlockUndecorated = <T>(
  raw: string,
  language: string,
  schema: z.ZodType<T>
): T | null => {
  const block = findSingletonBlock(raw, language)
  if (!block) return null
  return parseWithCache(language, block.content, schema)
}

export const getBlock = <T>(raw: string, language: string, schema: z.ZodType<T>): T | null => {
  const block = findSingletonBlock(raw, language)
  if (!block) return null
  const parsed = parseWithCache(language, block.content, schema)
  if (parsed === null) return null
  return decorateParsed<T>(raw, language, parsed as T, block.start)
}

// No recovery: a block that fails its schema yields nothing rather than a
// repaired subset. Use this where a second reader parses the same block
// strictly, so the two cannot disagree about what the document holds.
export const getBlocksStrict = <T>(raw: string, language: string, schema: z.ZodType<T>): T[] =>
  findBlocksByLanguage(raw, language)
    .map((block) => {
      const json = tryParseJson(block.content)
      const result = schema.safeParse(json)
      return result.success ? result.data : null
    })
    .filter((b): b is T => b !== null)

export const getBlocks = <T>(raw: string, language: string, schema: z.ZodType<T>): T[] =>
  findBlocksByLanguage(raw, language)
    .map((block): T | null => {
      const parsed = parseWithCache(language, block.content, schema)
      if (parsed === null) return null
      return decorateParsed<T>(raw, language, parsed as T, block.start)
    })
    .filter((b): b is T => b !== null)
