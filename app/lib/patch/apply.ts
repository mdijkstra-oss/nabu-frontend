import { applyDiff } from "./diff/parse"
import { expandRangeRefs, type FileReader } from "./resolve/range-expand"
import { injectBoundaryComments, stripBoundaryComments } from "./resolve/json-boundary"
import { stripPendingRefs } from "~/lib/files/pending-refs"
import { parseCodeBlocks, ensureFencesOnOwnLines } from "~/lib/data-blocks/parse"
import { fillMissingIds, buildGeneratedIdsList, type GeneratedId } from "~/lib/data-blocks/uuid"
import {
  validateStructural,
  validateSemantic,
  type ValidationError,
} from "~/lib/data-blocks/validate"
import { stampActors } from "~/lib/data-blocks/actor"
import { isSingleton } from "~/lib/data-blocks/registry"
import type { ValidationContext } from "~/lib/data-blocks/validate"
import { getFiles } from "~/lib/files/store"
import { getAllCodes } from "~/domain/data-blocks/callout/codes/selectors"
import { getTagDefinitions } from "~/domain/data-blocks/settings/tags/selectors"
import { getTags } from "~/domain/data-blocks/attributes/tags/selectors"
import { getSettings } from "~/domain/data-blocks/settings/selectors"
import { SETTINGS_FILE, isCompanionFile } from "~/lib/files/filename"
import { detectDanglingReferences } from "~/lib/data-blocks/refs"

export type FileResult =
  | { path: string; status: "ok"; content: string; generatedIds?: GeneratedId[] }
  | {
      path: string
      status: "partial"
      content: string
      warnings: string
      generatedIds?: GeneratedId[]
    }
  | { path: string; status: "error"; error: string; blockErrors?: ValidationError[] }

const isMdFile = (path: string): boolean => path.endsWith(".md")
const isJsonBlock = (language: string): boolean => language.startsWith("json-")

const ensureTrailingNewline = (s: string): string =>
  s.length > 0 && !s.endsWith("\n") ? s + "\n" : s

type RepairResult = { ok: true; content: string } | { ok: false; error: string }

const repairJsonNewlines = (json: string): RepairResult => {
  let result = ""
  let inString = false
  let i = 0

  while (i < json.length) {
    const char = json[i]
    if (char === '"' && (i === 0 || json[i - 1] !== "\\")) {
      inString = !inString
      result += char
    } else if (inString && char === "\n") {
      result += "\\n"
    } else if (inString && char === "\r") {
      result += "\\r"
    } else {
      result += char
    }
    i++
  }

  if (inString) {
    return { ok: false, error: "Unterminated string literal in JSON block" }
  }
  return { ok: true, content: result }
}

type RepairBlocksResult =
  | { ok: true; content: string }
  | { ok: false; error: string; language: string }

const repairJsonBlocks = (markdown: string): RepairBlocksResult => {
  const blocks = parseCodeBlocks(markdown).filter((b) => isJsonBlock(b.language))
  if (blocks.length === 0) return { ok: true, content: markdown }

  let result = markdown
  let offset = 0

  for (const block of blocks) {
    const repair = repairJsonNewlines(block.content)
    if (!repair.ok) {
      return { ok: false, error: repair.error, language: block.language }
    }
    if (repair.content === block.content) continue

    const blockStart = block.start + offset
    const blockEnd = block.end + offset
    const original = result.slice(blockStart, blockEnd)
    const replaced = original.replace(block.content, () => repair.content)

    result = result.slice(0, blockStart) + replaced + result.slice(blockEnd)
    offset += replaced.length - original.length
  }

  return { ok: true, content: result }
}

const formatBlock = (language: string, content: string): string =>
  `\`\`\`${language}\n${content}\n\`\`\``

const enrichStructuralErrors = (
  errors: ValidationError[],
  originalMarkdown: string | undefined
): ValidationError[] => {
  if (!originalMarkdown) return errors
  const originals = parseCodeBlocks(originalMarkdown)
  return errors.map((err) => {
    if (!isSingleton(err.block)) return err
    const original = originals.find((b) => b.language === err.block)
    if (!original) return err
    return { ...err, currentBlock: formatBlock(original.language, original.content) }
  })
}

const buildValidationContext = (): ValidationContext => ({
  availableCodes: getAllCodes(getFiles()).map((c) => ({ id: c.id, name: c.title })),
  availableTags: getTagDefinitions(getFiles()).map((t) => ({ id: t.id, label: t.label })),
})

const formatBlockErrors = (errors: ValidationError[]): string =>
  errors
    .map((e) => {
      const location = e.field ? `${e.block}.${e.field}` : e.block
      const received = e.received ? ` (received: ${e.received})` : ""
      const hint = e.hint ? ` Available: ${JSON.stringify(e.hint)}` : ""
      const current = e.currentBlock ? `\nCurrent block:\n${e.currentBlock}` : ""
      return `${location}: ${e.message}${received}${hint}${current}`
    })
    .join("\n")

const buildTagReferenceMap = (
  files: Record<string, string>,
  excludePath: string
): Map<string, string[]> => {
  const refs = new Map<string, string[]>()
  for (const [path, content] of Object.entries(files)) {
    if (path === excludePath) continue
    for (const tagId of getTags(content)) {
      refs.set(tagId, [...(refs.get(tagId) ?? []), path])
    }
  }
  return refs
}

interface ApplyMdPatchOptions {
  skipImmutableCheck?: boolean
  skipSemanticValidation?: boolean
  placeholderIds?: Record<string, string>
  actor?: "ai" | "user"
}

interface FinalizeContentOptions {
  original: string
  actor?: "ai" | "user"
  skipImmutableCheck?: boolean
  skipSemanticValidation?: boolean
  placeholderIds?: Record<string, string>
}

const toViewContent = (raw: string): string => injectBoundaryComments(stripPendingRefs(raw))

const buildFileReader =
  (currentPath: string, currentContent: string): FileReader =>
  (p) => {
    const raw = p === currentPath ? currentContent : getFiles()[p]
    return raw !== undefined ? toViewContent(raw) : undefined
  }

export const finalizeContent = (
  path: string,
  content: string,
  options: FinalizeContentOptions
): FileResult => {
  const { content: filledContent, generated: autoGenerated } = fillMissingIds(
    content,
    options.original
  )
  const stampedContent = options.actor
    ? stampActors(options.original, filledContent, options.actor)
    : filledContent
  const sanitizedContent = ensureFencesOnOwnLines(stampedContent)

  // Companion files (per-source embedding vectors) are programmatic — written only by
  // lib/embeddings/sync.ts via buildCompanionMarkdown. No user/agent editing. Schema parsing
  // 1024-float arrays per block is purely waste, and any "failure" here can't be acted on
  // since the source of truth is the embeddings sync, not the patch path.
  const skipBlockValidation = isCompanionFile(path)

  if (!skipBlockValidation) {
    const structuralErrors = validateStructural(sanitizedContent)
    if (structuralErrors.length > 0) {
      const enriched = enrichStructuralErrors(structuralErrors, options.original)
      return {
        path,
        status: "error",
        error: formatBlockErrors(enriched),
        blockErrors: enriched,
      }
    }
  }

  const validation = skipBlockValidation
    ? { valid: true, errors: [], warnings: [], recoveredMarkdown: undefined }
    : validateSemantic(sanitizedContent, {
        path,
        context: buildValidationContext(),
        original: options.original,
        skipImmutableCheck: options.skipImmutableCheck,
      })

  if (!validation.valid) {
    if (options.skipSemanticValidation) {
      console.warn(
        `[patch] semantic validation warnings for "${path}":`,
        formatBlockErrors(validation.errors)
      )
    } else {
      return {
        path,
        status: "error",
        error: formatBlockErrors(validation.errors),
        blockErrors: validation.errors,
      }
    }
  }

  const finalContent = validation.recoveredMarkdown ?? sanitizedContent

  if (options.original && path === SETTINGS_FILE) {
    const files = getFiles()
    const oldTagIds = getTagDefinitions(files).map((t) => t.id)
    const newTagIds = (getSettings(finalContent)?.tags ?? []).map((t) => t.id)
    const refs = buildTagReferenceMap(files, path)
    const refErrors = detectDanglingReferences(oldTagIds, newTagIds, refs)
    if (refErrors.length > 0) {
      return { path, status: "error", error: formatBlockErrors(refErrors), blockErrors: refErrors }
    }
  }

  const generatedIds = buildGeneratedIdsList(
    options.placeholderIds ?? {},
    autoGenerated,
    finalContent
  )

  const hasWarnings = validation.warnings.length > 0

  if (hasWarnings) {
    return {
      path,
      status: "partial",
      content: finalContent,
      warnings: validation.warnings.join("\n"),
      ...(generatedIds.length > 0 && { generatedIds }),
    }
  }

  return {
    path,
    status: "ok",
    content: finalContent,
    ...(generatedIds.length > 0 && { generatedIds }),
  }
}

const applyMdPatch = (
  path: string,
  content: string,
  patch: string,
  options: ApplyMdPatchOptions = {}
): FileResult => {
  if (content === "" && patch === "") {
    return { path, status: "ok", content: "" }
  }

  const rangeResult = expandRangeRefs(patch, buildFileReader(path, content), path)
  if (!rangeResult.ok) return { path, status: "error", error: rangeResult.error }

  const viewContent = toViewContent(content)
  const diffResult = applyDiff(viewContent, rangeResult.patch)
  if (!diffResult.ok) {
    return { path, status: "error", error: diffResult.error }
  }

  const rawContent = stripBoundaryComments(diffResult.content)
  const repair = repairJsonBlocks(rawContent)
  if (!repair.ok) {
    return {
      path,
      status: "error",
      error: `${repair.language}: ${repair.error}`,
      blockErrors: [{ block: repair.language, message: repair.error }],
    }
  }
  const repairedContent = ensureTrailingNewline(repair.content)
  return finalizeContent(path, repairedContent, { original: content, ...options })
}

interface ApplyFilePatchOptions {
  skipImmutableCheck?: boolean
  skipSemanticValidation?: boolean
  placeholderIds?: Record<string, string>
  actor?: "ai" | "user"
}

export const applyFilePatch = (
  path: string,
  content: string,
  patch: string,
  options: ApplyFilePatchOptions = {}
): FileResult =>
  isMdFile(path)
    ? applyMdPatch(path, content, patch, options)
    : { path, status: "error", error: `only .md files allowed: ${path}` }
