import { parseCodeBlocks, collapseBlankLines, formatBlock, type CodeBlock } from "./parse"
import { isSingleton, getSingletonLanguages, getNormalizeAsFileFields } from "./registry"
import { normalizeContent } from "~/lib/patch/diff/normalize"
import { tryParseJson } from "./json"

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
