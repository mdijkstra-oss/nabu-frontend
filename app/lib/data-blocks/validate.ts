import equal from "fast-deep-equal"
import {
  getBlockConfig,
  isSingleton,
  getImmutableFields,
  getAllowedFiles,
} from "~/lib/data-blocks/registry"
import type { AsyncValidationContext, ValidationContext } from "./definition"
import { parseCodeBlocks, type CodeBlock } from "./parse"
import { tryParseJson } from "./json"
import { recoverArrayItems } from "./query"
import { validateFences, type FenceError } from "./validate-fences"

export type { ValidationContext } from "./definition"

export interface ValidationError {
  block: string
  field?: string
  message: string
  received?: string
  currentBlock?: string
  hint?: Record<string, string>
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
  recoveredMarkdown?: string
}

export interface ValidateOptions {
  path?: string
  context?: ValidationContext
  original?: string
  skipImmutableCheck?: boolean
}

const FENCE_BLOCK = "_fences"

const fenceErrorsToValidationErrors = (fenceErrors: FenceError[]): ValidationError[] =>
  fenceErrors.map((e) => ({
    block: FENCE_BLOCK,
    field: `line ${e.line}`,
    message: e.message,
  }))

export const validateMarkdownBlocks = (
  markdown: string,
  options: ValidateOptions = {}
): ValidationResult => {
  const fenceErrors = validateFences(markdown)
  if (fenceErrors.length > 0) {
    return {
      valid: false,
      errors: fenceErrorsToValidationErrors(fenceErrors),
      warnings: [],
    }
  }

  const blocks = parseCodeBlocks(markdown)
  const errors: ValidationError[] = []
  const warnings: string[] = []
  let currentMarkdown = markdown

  errors.push(...validateSingletons(markdown))

  const context = options.context ?? {
    availableCodes: [],
    availableTags: [],
  }

  const originalBlocks = options.original ? parseCodeBlocks(options.original) : []
  const originalBlocksByLanguage = groupBlocksByLanguage(originalBlocks)

  for (const block of blocks) {
    const config = getBlockConfig(block.language)
    if (!config) {
      errors.push({
        block: block.language,
        message: `\`${block.language}\` is not a known data-block language. Only registered data blocks are allowed.`,
      })
      continue
    }

    const fileError = validateFileConstraint(block.language, options.path)
    if (fileError) {
      errors.push(fileError)
      continue
    }

    const blockResult = validateBlockSchema(block.language, block.content, context)
    let blockErrors = blockResult.errors

    if (blockResult.recovered) {
      warnings.push(...blockResult.droppedWarnings)
      currentMarkdown = replaceBlockContent(currentMarkdown, block, blockResult.recovered)
      blockErrors = []
    }

    if (options.original) {
      const findResult = findOriginalBlock(block, originalBlocksByLanguage)

      if (findResult.found) {
        if (!options.skipImmutableCheck) {
          const immutableErrors = validateImmutableFields(block.language, block, findResult.block)
          errors.push(...immutableErrors)
        }

        if (blockErrors.length > 0) {
          const currentBlock = formatBlock(block.language, findResult.block.content)
          for (const error of blockErrors) {
            error.currentBlock = currentBlock
          }
        }
      } else if (isNewSingleton(block.language, originalBlocksByLanguage)) {
        // no-op: new singleton creation — skip immutable check, let schema errors through
      } else if (blockErrors.length > 0 && !options.skipImmutableCheck) {
        errors.push(findResult.error)
        continue
      }
    }

    errors.push(...blockErrors)
  }

  if (options.original && !options.skipImmutableCheck) {
    errors.push(...detectOrphanedIds(blocks, originalBlocksByLanguage))
  }

  const hasRecovery = currentMarkdown !== markdown
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    ...(hasRecovery && { recoveredMarkdown: currentMarkdown }),
  }
}

export const formatValidationErrors = (errors: ValidationError[]): string =>
  errors
    .map((e) => {
      const location = e.field ? `${e.block}.${e.field}` : e.block
      return `${location}: ${e.message}`
    })
    .join("\n")

export const validateBlocksAsync = async (
  markdown: string,
  context: AsyncValidationContext
): Promise<ValidationResult> => {
  const blocks = parseCodeBlocks(markdown)
  const errors: ValidationError[] = []

  for (const block of blocks) {
    const config = getBlockConfig(block.language)
    if (!config?.asyncValidate) continue

    const result = config.schema().safeParse(tryParseJson(block.content))
    if (!result.success) continue

    const asyncErrors = await config.asyncValidate(result.data, context)
    errors.push(...asyncErrors)
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}

const formatBlock = (language: string, content: string): string =>
  `\`\`\`${language}\n${content}\n\`\`\``

const validateFileConstraint = (
  language: string,
  path: string | undefined
): ValidationError | null => {
  const allowed = getAllowedFiles(language)
  if (!allowed || !path) return null
  if (allowed.includes(path)) return null
  return {
    block: language,
    message: `\`${language}\` blocks can only exist in: ${allowed.join(", ")}`,
  }
}

interface BlockSchemaResult {
  errors: ValidationError[]
  recovered?: string
  droppedWarnings: string[]
}

const extractHint = (issue: { params?: unknown }): Record<string, string> | undefined => {
  const params = issue.params as Record<string, unknown> | undefined
  return params?.hint as Record<string, string> | undefined
}

const isPrimitive = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean"

const resolvePathValue = (data: unknown, path: PropertyKey[]): string | undefined => {
  if (path.length === 0) return undefined
  let current: unknown = data
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== "object") return undefined
    current = (current as Record<PropertyKey, unknown>)[key]
  }
  if (!isPrimitive(current)) return undefined
  return typeof current === "string" ? `"${current}"` : String(current)
}

const issueToError = (
  language: string,
  issue: { path: PropertyKey[]; message: string; params?: unknown },
  parsed: unknown
): ValidationError => {
  const hint = extractHint(issue)
  const received = resolvePathValue(parsed, issue.path)
  return {
    block: language,
    field: issue.path.map(String).join("."),
    message: issue.message,
    ...(received !== undefined && { received }),
    ...(hint && { hint }),
  }
}

const isRecoverableObject = (json: unknown): json is Record<string, unknown> =>
  typeof json === "object" && json !== null && !Array.isArray(json)

const validateBlockSchema = (
  language: string,
  content: string,
  context?: ValidationContext
): BlockSchemaResult => {
  const config = getBlockConfig(language)
  if (!config) return { errors: [], droppedWarnings: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    const reason = e instanceof SyntaxError ? e.message : "Unknown error"
    return {
      errors: [{ block: language, message: `Invalid JSON: ${reason}` }],
      droppedWarnings: [],
    }
  }

  const schema = config.schema(context)
  const result = schema.safeParse(parsed)

  if (result.success) return { errors: [], droppedWarnings: [] }

  const errors = result.error.issues.map((issue) => issueToError(language, issue, parsed))

  if (isRecoverableObject(parsed)) {
    const baseSchema = config.schema()
    const recovered = recoverArrayItems(parsed, baseSchema)
    if (recovered) {
      const droppedWarnings = result.error.issues.map((i) => i.message)
      return {
        errors: [],
        recovered: JSON.stringify(recovered, null, "\t"),
        droppedWarnings,
      }
    }
  }

  return { errors, droppedWarnings: [] }
}

const replaceBlockContent = (markdown: string, block: CodeBlock, newContent: string): string => {
  const header = `\`\`\`${block.language}\n`
  const footer = `\n\`\`\``
  return markdown.slice(0, block.start) + header + newContent + footer + markdown.slice(block.end)
}

const validateSingletons = (markdown: string): ValidationError[] => {
  const blocks = parseCodeBlocks(markdown)
  const errors: ValidationError[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (isSingleton(block.language)) {
      if (seen.has(block.language)) {
        errors.push({
          block: block.language,
          message: `Only one ${block.language} block allowed per file`,
        })
      }
      seen.add(block.language)
    }
  }

  return errors
}

type BlocksByLanguage = Record<string, CodeBlock[]>

const isNewSingleton = (language: string, originalBlocksByLanguage: BlocksByLanguage): boolean =>
  isSingleton(language) && (originalBlocksByLanguage[language] ?? []).length === 0

const groupBlocksByLanguage = (blocks: CodeBlock[]): BlocksByLanguage =>
  blocks.reduce<BlocksByLanguage>((acc, block) => {
    const list = acc[block.language] ?? []
    return { ...acc, [block.language]: [...list, block] }
  }, {})

const getBlockId = (block: CodeBlock): string | null =>
  tryParseJson(block.content)?.id as string | null

type FindBlockResult = { found: true; block: CodeBlock } | { found: false; error: ValidationError }

const findOriginalBlock = (
  block: CodeBlock,
  originalBlocksByLanguage: BlocksByLanguage
): FindBlockResult => {
  const originalBlocks = originalBlocksByLanguage[block.language] ?? []

  if (isSingleton(block.language)) {
    return originalBlocks[0]
      ? { found: true, block: originalBlocks[0] }
      : { found: false, error: { block: block.language, message: "No original block found" } }
  }

  const id = getBlockId(block)
  if (!id) {
    return {
      found: false,
      error: {
        block: block.language,
        message: `Block of type ${block.language} is missing identifier. Add an "id" field.`,
      },
    }
  }

  const original = originalBlocks.find((b) => getBlockId(b) === id)
  return original
    ? { found: true, block: original }
    : {
        found: false,
        error: { block: block.language, message: `No original block found with id "${id}"` },
      }
}

const DEFAULT_IMMUTABLE_MESSAGE = (field: string) =>
  `Field "${field}" is immutable and cannot be changed`

const normalizeEmpty = (value: unknown): unknown => (value === "" ? undefined : value)

const valuesEqual = (a: unknown, b: unknown): boolean => {
  const aNorm = normalizeEmpty(a)
  const bNorm = normalizeEmpty(b)
  return equal(aNorm, bNorm)
}

const validateImmutableFields = (
  language: string,
  newBlock: CodeBlock,
  originalBlock: CodeBlock
): ValidationError[] => {
  const newParsed = tryParseJson(newBlock.content)
  const originalParsed = tryParseJson(originalBlock.content)

  if (!newParsed || !originalParsed) return []

  const errors: ValidationError[] = []
  const configImmutable = getImmutableFields(language)
  const immutableFields: Record<string, string> = originalParsed.id
    ? { id: DEFAULT_IMMUTABLE_MESSAGE("id"), ...configImmutable }
    : configImmutable

  for (const [field, message] of Object.entries(immutableFields)) {
    const originalValue = originalParsed[field]
    const newValue = newParsed[field]

    if (normalizeEmpty(originalValue) !== undefined && !valuesEqual(originalValue, newValue)) {
      errors.push({
        block: language,
        field,
        message,
      })
    }
  }

  return errors
}

const detectOrphanedIds = (
  newBlocks: CodeBlock[],
  originalBlocksByLanguage: BlocksByLanguage
): ValidationError[] => {
  const errors: ValidationError[] = []
  const newBlocksByLanguage = groupBlocksByLanguage(newBlocks)

  for (const [language, originals] of Object.entries(originalBlocksByLanguage)) {
    if (isSingleton(language)) continue

    const news = newBlocksByLanguage[language] ?? []
    const originalIds = originals.map(getBlockId).filter((id): id is string => id !== null)
    const newIds = new Set(news.map(getBlockId).filter((id): id is string => id !== null))
    const isLegitimateDelete = news.length < originals.length

    for (const originalId of originalIds) {
      if (!newIds.has(originalId) && !isLegitimateDelete) {
        errors.push({
          block: language,
          field: "id",
          message: `Block with id "${originalId}" was removed. To update, keep the same id. To delete, remove the entire block.`,
        })
      }
    }
  }

  return errors
}
