import {
  parseCodeBlocks,
  findBlocksByLanguage,
  collapseBlankLines,
  formatBlock,
  type CodeBlock,
} from "./parse"
import {
  isSingleton,
  getSingletonLanguages,
  getNormalizeAsFileFields,
  getExpandIdRefs,
  findBlockConfigByPrefix,
} from "./registry"
import { normalizeContent } from "~/lib/patch/diff/normalize"
import { tryParseJson, parsePath, isObject } from "./json"
import type { IdRefExpansion } from "./definition"

export type IdResolver = (id: string) => string | undefined

const isSingletonBlock = (block: CodeBlock): boolean => isSingleton(block.language)

const stripBlocks = (content: string, blocks: CodeBlock[]): string => {
  let result = content
  for (let i = blocks.length - 1; i >= 0; i--) {
    result = result.slice(0, blocks[i].start) + result.slice(blocks[i].end)
  }
  return collapseBlankLines(result).trim()
}

const appendInOrder = (prose: string, singletons: CodeBlock[]): string => {
  const byLanguage = new Map(singletons.map((b) => [b.language, b]))
  const parts: string[] = prose ? [prose] : []

  for (const lang of getSingletonLanguages()) {
    const block = byLanguage.get(lang)
    if (block) {
      parts.push(formatBlock(lang, block.content))
    }
  }

  return parts.join("\n\n")
}

export const normalizeSingletonOrder = (content: string): string => {
  const blocks = parseCodeBlocks(content)
  const singletons = blocks.filter(isSingletonBlock)

  if (singletons.length === 0) return content

  const prose = stripBlocks(content, singletons)
  return appendInOrder(prose, singletons)
}

const normalizeFieldValues = (
  parsed: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> | null => {
  let changed = false
  const result = { ...parsed }

  for (const field of fields) {
    const value = parsed[field]
    if (typeof value !== "string") continue
    const normalized = normalizeContent(value)
    if (normalized !== value) {
      result[field] = normalized
      changed = true
    }
  }

  return changed ? result : null
}

export const normalizeBlockFields = (markdown: string): string => {
  const blocks = parseCodeBlocks(markdown)
  let result = markdown
  let offset = 0

  for (const block of blocks) {
    const fields = getNormalizeAsFileFields(block.language)
    if (fields.length === 0) continue

    const parsed = tryParseJson(block.content)
    if (!parsed) continue

    const normalized = normalizeFieldValues(parsed, fields)
    if (!normalized) continue

    const newContent = JSON.stringify(normalized, null, "\t")
    const header = `\`\`\`${block.language}\n`
    const footer = `\n\`\`\``
    const oldSection = result.slice(block.start + offset, block.end + offset)
    const newSection = header + newContent + footer
    result = result.slice(0, block.start + offset) + newSection + result.slice(block.end + offset)
    offset += newSection.length - oldSection.length
  }

  return result
}

const SYSTEM_ID_SUFFIX = "(?=[a-z0-9]*\\d)[a-z0-9]{6,10}"

const buildIdRegex = (prefix: string): RegExp =>
  new RegExp(`\\b${prefix}-${SYSTEM_ID_SUFFIX}\\b`, "g")

const buildEntityLookup = (
  sourceBlock: CodeBlock,
  idPath: string,
  replaceWith: string
): Map<string, string> => {
  const lookup = new Map<string, string>()
  const parsed = tryParseJson(sourceBlock.content)
  if (!parsed) return lookup

  const pathInfo = parsePath(idPath)
  if (!pathInfo) return lookup

  if (pathInfo.type === "array") {
    const arr = parsed[pathInfo.arrayField]
    if (!Array.isArray(arr)) return lookup
    for (const item of arr) {
      if (!isObject(item)) continue
      const id = item[pathInfo.itemField]
      const text = item[replaceWith]
      if (typeof id === "string" && typeof text === "string") {
        lookup.set(id, text)
      }
    }
  } else if (pathInfo.type === "root-array") {
    if (!Array.isArray(parsed)) return lookup
    for (const item of parsed as unknown[]) {
      if (!isObject(item)) continue
      const id = item[pathInfo.itemField]
      const text = item[replaceWith]
      if (typeof id === "string" && typeof text === "string") {
        lookup.set(id, text)
      }
    }
  } else {
    const id = parsed[pathInfo.field]
    const text = parsed[replaceWith]
    if (typeof id === "string" && typeof text === "string") {
      lookup.set(id, text)
    }
  }

  return lookup
}

const expandField = (
  value: string,
  expansion: IdRefExpansion,
  lookup: Map<string, string>,
  resolveId?: IdResolver
): string => {
  const regex = buildIdRegex(expansion.prefix)
  return value.replace(regex, (match) => lookup.get(match) ?? resolveId?.(match) ?? match)
}

const expandBlockFields = (
  parsed: Record<string, unknown>,
  expansions: IdRefExpansion[],
  markdown: string,
  resolveId?: IdResolver
): Record<string, unknown> | null => {
  let changed = false
  const result = { ...parsed }

  for (const expansion of expansions) {
    const value = result[expansion.field]
    if (typeof value !== "string") continue

    const sourceConfig = findBlockConfigByPrefix(expansion.prefix)
    if (!sourceConfig) continue

    const idPathConfig = sourceConfig.config.idPaths?.find((p) => p.prefix === expansion.prefix)
    if (!idPathConfig) continue

    const sourceBlocks = findBlocksByLanguage(markdown, sourceConfig.language)

    const lookup = new Map<string, string>()
    for (const sourceBlock of sourceBlocks) {
      for (const [k, v] of buildEntityLookup(
        sourceBlock,
        idPathConfig.path,
        expansion.replaceWith
      )) {
        lookup.set(k, v)
      }
    }

    if (lookup.size === 0 && !resolveId) continue

    const expanded = expandField(value, expansion, lookup, resolveId)
    if (expanded !== value) {
      result[expansion.field] = expanded
      changed = true
    }
  }

  return changed ? result : null
}

export const expandBlockIdRefs = (markdown: string, resolveId?: IdResolver): string => {
  const blocks = parseCodeBlocks(markdown)
  let result = markdown
  let offset = 0

  for (const block of blocks) {
    const expansions = getExpandIdRefs(block.language)
    if (expansions.length === 0) continue

    const parsed = tryParseJson(block.content)
    if (!parsed) continue

    const expanded = expandBlockFields(parsed, expansions, markdown, resolveId)
    if (!expanded) continue

    const newContent = JSON.stringify(expanded, null, "\t")
    const header = `\`\`\`${block.language}\n`
    const footer = `\n\`\`\``
    const oldSection = result.slice(block.start + offset, block.end + offset)
    const newSection = header + newContent + footer
    result = result.slice(0, block.start + offset) + newSection + result.slice(block.end + offset)
    offset += newSection.length - oldSection.length
  }

  return result
}
