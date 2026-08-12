import { parseCodeBlocks } from "~/lib/data-blocks/parse"
import { getBlockConfig } from "~/lib/data-blocks/registry"
import { tryParseJson, isObject } from "~/lib/data-blocks/json"
import { INFERRED_META } from "./schema"

const withoutField = (value: Record<string, unknown>): Record<string, unknown> | null => {
  if (!(INFERRED_META in value)) return null
  const { [INFERRED_META]: _dropped, ...rest } = value
  return rest
}

const stripRows = (
  value: Record<string, unknown>,
  rowPath: string
): Record<string, unknown> | null => {
  const rows = value[rowPath]
  if (!Array.isArray(rows)) return null
  let changed = false
  const next = rows.map((row) => {
    if (!isObject(row)) return row
    const stripped = withoutField(row)
    if (!stripped) return row
    changed = true
    return stripped
  })
  return changed ? { ...value, [rowPath]: next } : null
}

// A decoration is a view. Persisting one would put a derived value in the document
// that no invalidation ever revisits, so it is removed on every write path.
export const stripInferredMeta = (
  value: Record<string, unknown>,
  rowPath?: string
): Record<string, unknown> | null => {
  const atRoot = withoutField(value)
  const base = atRoot ?? value
  const inRows = rowPath ? stripRows(base, rowPath) : null
  return inRows ?? atRoot
}

export const stripInferredMetaBlocks = (markdown: string): string => {
  if (!markdown.includes(INFERRED_META)) return markdown

  const blocks = parseCodeBlocks(markdown)
  let result = markdown
  let offset = 0

  for (const block of blocks) {
    if (!block.content.includes(INFERRED_META)) continue
    const parsed = tryParseJson(block.content)
    if (!parsed) continue

    const stripped = stripInferredMeta(parsed, getBlockConfig(block.language)?.rowPath)
    if (!stripped) continue

    const newSection = `\`\`\`${block.language}\n${JSON.stringify(stripped, null, "\t")}\n\`\`\``
    const oldLength = block.end - block.start
    result = result.slice(0, block.start + offset) + newSection + result.slice(block.end + offset)
    offset += newSection.length - oldLength
  }

  return result
}
