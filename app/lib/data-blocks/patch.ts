import type { JsonPatchOp } from "~/lib/patch/structured-json/apply"
import { applyEnrichedOps } from "~/lib/patch/structured-json/pipeline"
import {
  findSingletonBlock,
  findBlockById,
  parseBlockJson,
  replaceBlock,
  replaceSingletonBlock,
  type CodeBlock,
} from "~/lib/data-blocks/parse"
import { isKnownBlockType, isSingleton, getFuzzyFields } from "~/lib/data-blocks/registry"
import { getFile, updateFileRaw } from "~/lib/files/store"
import { finalizeContent } from "~/lib/patch/apply"

export type PatchResult = { ok: true; content: string } | { ok: false; error: string }

type ResolvedBlock =
  | { ok: true; json: unknown; block: CodeBlock | null }
  | { ok: false; error: string }

const formatJson = (obj: object): string => JSON.stringify(obj, null, "\t")

const isSingletonLanguage = (language: string): boolean =>
  !isKnownBlockType(language) || isSingleton(language)

const findBlock = (content: string, language: string, blockId?: string): ResolvedBlock => {
  if (isSingletonLanguage(language)) {
    const block = findSingletonBlock(content, language)
    if (!block) return { ok: true, json: {}, block: null }
    const parsed = parseBlockJson(block)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    return { ok: true, json: parsed.data, block }
  }

  if (!blockId) return { ok: false, error: `block_id required for ${language}` }
  const found = findBlockById(content, language, blockId)
  if (!found) return { ok: false, error: `No ${language} block with id "${blockId}"` }
  return { ok: true, json: found.data, block: found.block }
}

const writeBack = (
  content: string,
  language: string,
  block: CodeBlock | null,
  newJson: string
): string =>
  block ? replaceBlock(content, block, newJson) : replaceSingletonBlock(content, language, newJson)

export const patchBlockContent = (
  content: string,
  language: string,
  ops: JsonPatchOp[],
  blockId?: string
): PatchResult => {
  const resolved = findBlock(content, language, blockId)
  if (!resolved.ok) return resolved

  const fuzzyFields = getFuzzyFields(language)
  const { doc, applied, failures } = applyEnrichedOps(ops, resolved.json, content, { fuzzyFields })

  if (applied === 0) return { ok: false, error: failures.join("\n") || "No operations applied" }

  const newContent = writeBack(content, language, resolved.block, formatJson(doc as object))
  if (newContent === content) return { ok: false, error: "No changes" }

  return { ok: true, content: newContent }
}

export const patchBlock = (
  path: string,
  language: string,
  ops: JsonPatchOp[],
  blockId?: string
): string | null => {
  const content = getFile(path)
  if (content === undefined) return `${path}: No such file`

  const result = patchBlockContent(content, language, ops, blockId)
  if (!result.ok) return result.error

  const finalized = finalizeContent(path, result.content, { original: content })
  if (finalized.status === "error") return finalized.error

  updateFileRaw(finalized.path, finalized.content)
  return null
}
