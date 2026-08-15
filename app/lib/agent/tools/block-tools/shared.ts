import { z } from "zod"
import { formatZodError } from "../../executors/tool"
import {
  findSingletonBlock,
  findBlockById,
  summarizeBlocks,
  parseBlockJson,
  replaceBlock,
  replaceSingletonBlock,
  stripBlock,
  type CodeBlock,
} from "~/lib/data-blocks/parse"
import type { JsonPatchOp } from "~/lib/patch/structured-json/apply"
import {
  getBlockConfig,
  isKnownBlockType,
  isSingleton,
  getLabelKey,
} from "~/lib/data-blocks/registry"
import { getFile } from "~/lib/files/store"

export interface ResolvedFile {
  content: string
  path: string
}

const normalizeDoubleExt = (path: string): string => path.replace(/(\.\w+)\1+$/, "$1")

export const resolveFile = (path: string): ResolvedFile | null => {
  const exact = getFile(path)
  if (exact !== undefined) return { content: exact, path }

  const normalized = normalizeDoubleExt(path)
  if (normalized !== path) {
    const content = getFile(normalized)
    if (content !== undefined) return { content, path: normalized }
  }

  return null
}

type JsonSchemaObj = Record<string, unknown> & { properties?: Record<string, { type?: string }> }

export const schemaArrayFields = (language: string): Set<string> | null => {
  const config = getBlockConfig(language)
  if (!config) return null
  const schema = z.toJSONSchema(config.schema(), { io: "input" }) as JsonSchemaObj
  if (!schema.properties) return new Set()
  return new Set(
    Object.entries(schema.properties)
      .filter(([, prop]) => prop.type === "array")
      .map(([key]) => key)
  )
}

const appendTargets = (ops: JsonPatchOp[]): string[] => [
  ...new Set(
    ops.filter((op) => op.path.endsWith("/-")).map((op) => op.path.split("/").filter(Boolean)[0])
  ),
]

export const seedAppendArrays = (
  ops: JsonPatchOp[],
  validFields: Set<string>
): Record<string, unknown> => {
  const doc: Record<string, unknown> = {}
  for (const field of appendTargets(ops)) {
    if (validFields.has(field)) doc[field] = []
  }
  return doc
}

export const validatePatchedDoc = (language: string, doc: unknown): string | null => {
  const config = getBlockConfig(language)
  if (!config) return null
  const result = config.schema().safeParse(doc)
  if (result.success) return null
  return formatZodError(result.error)
}

export { formatBlockJson as formatJson } from "~/lib/data-blocks/parse"

export const formatBlockList = (summaries: { id: string; label: string | undefined }[]): string =>
  summaries.map((s) => (s.label ? `  ${s.id} (${s.label})` : `  ${s.id}`)).join("\n")

export type ResolvedBlock =
  | { ok: true; json: unknown; block: CodeBlock | null }
  | { ok: false; error: string }

export interface ResolveBlockArgs {
  content: string
  language: string
  blockId: string | undefined
  operations: JsonPatchOp[]
}

const isMultiBlockLanguage = (language: string): boolean =>
  isKnownBlockType(language) && !isSingleton(language)

export const resolveBlock = ({
  content,
  language,
  blockId,
  operations,
}: ResolveBlockArgs): ResolvedBlock => {
  if (!isMultiBlockLanguage(language)) {
    const block = findSingletonBlock(content, language)
    if (block) {
      const parsed = parseBlockJson(block)
      if (!parsed.ok)
        return {
          ok: false,
          error: `Failed to parse JSON in \`${language}\` block: ${parsed.error}\n---\n${parsed.raw}`,
        }
      return { ok: true, json: parsed.data, block }
    }
    const validFields = schemaArrayFields(language)
    if (!validFields) return { ok: false, error: `No \`${language}\` block found` }
    return { ok: true, json: seedAppendArrays(operations, validFields), block: null }
  }

  if (!blockId) {
    const summaries = summarizeBlocks(content, language, getLabelKey(language))
    if (summaries.length === 0)
      return { ok: false, error: `No \`${language}\` blocks found in this file` }
    return {
      ok: false,
      error: `block_id is required for \`${language}\`. Available blocks:\n${formatBlockList(summaries)}`,
    }
  }

  const found = findBlockById(content, language, blockId)
  if (!found) {
    const summaries = summarizeBlocks(content, language, getLabelKey(language))
    const available =
      summaries.length > 0
        ? `Available blocks:\n${formatBlockList(summaries)}`
        : `No \`${language}\` blocks found in this file`
    return { ok: false, error: `No \`${language}\` block with id "${blockId}". ${available}` }
  }

  return { ok: true, json: found.data, block: found.block }
}

export type ResolvedBlockForDelete = { ok: true; block: CodeBlock } | { ok: false; error: string }

export const resolveBlockForDelete = (
  content: string,
  language: string,
  blockId: string | undefined
): ResolvedBlockForDelete => {
  if (!isMultiBlockLanguage(language)) {
    const block = findSingletonBlock(content, language)
    if (!block) return { ok: false, error: `No \`${language}\` block found` }
    return { ok: true, block }
  }

  if (!blockId) {
    const summaries = summarizeBlocks(content, language, getLabelKey(language))
    if (summaries.length === 0)
      return { ok: false, error: `No \`${language}\` blocks found in this file` }
    return {
      ok: false,
      error: `block_id is required for \`${language}\`. Available blocks:\n${formatBlockList(summaries)}`,
    }
  }

  const found = findBlockById(content, language, blockId)
  if (!found) {
    const summaries = summarizeBlocks(content, language, getLabelKey(language))
    const available =
      summaries.length > 0
        ? `Available blocks:\n${formatBlockList(summaries)}`
        : `No \`${language}\` blocks found in this file`
    return { ok: false, error: `No \`${language}\` block with id "${blockId}". ${available}` }
  }

  return { ok: true, block: found.block }
}

export const writeBack = (
  content: string,
  language: string,
  block: CodeBlock | null,
  newJson: string
): string =>
  block ? replaceBlock(content, block, newJson) : replaceSingletonBlock(content, language, newJson)

export const deleteBlock = (content: string, block: CodeBlock): string => stripBlock(content, block)
