import type { JsonPatchOp } from "./apply"
import { hasFuzzyPatterns, resolveFuzzyPatterns } from "../resolve/fuzzy-match"

export interface FuzzyFieldPattern {
  parentRegex: RegExp
  directRegex: RegExp
  field: string
}

type ResolveResult = { ok: true; ops: JsonPatchOp[] } | { ok: false; error: string }

type ValueOp = JsonPatchOp & { value: unknown }

export const parseFuzzyFieldPattern = (pattern: string): FuzzyFieldPattern => {
  const rootArrayMatch = pattern.match(/^\*\.(.+)$/)
  if (rootArrayMatch) {
    const field = rootArrayMatch[1]
    const parentRegex = new RegExp(`^\\/[^/]+$`)
    const directRegex = new RegExp(`^\\/[^/]+\\/${escapeRegex(field)}$`)
    return { parentRegex, directRegex, field }
  }

  const starIndex = pattern.indexOf(".*.")
  if (starIndex === -1) throw new Error(`invalid fuzzy field pattern: ${pattern}`)
  const arraySegment = pattern.slice(0, starIndex)
  const field = pattern.slice(starIndex + 3)
  const parentRegex = new RegExp(`\\/${escapeRegex(arraySegment)}\\/[^/]+$`)
  const directRegex = new RegExp(`\\/${escapeRegex(arraySegment)}\\/[^/]+\\/${escapeRegex(field)}$`)
  return { parentRegex, directRegex, field }
}

export const parseFuzzyFieldPatterns = (patterns: string[]): FuzzyFieldPattern[] =>
  patterns.map(parseFuzzyFieldPattern)

export const autoFuzzyFieldValue = (
  op: JsonPatchOp,
  patterns: FuzzyFieldPattern[]
): JsonPatchOp => {
  if (!isValueOp(op)) return op

  for (const pattern of patterns) {
    const parentWrapped = wrapParentField(op, pattern)
    if (parentWrapped) return parentWrapped

    const directWrapped = wrapDirectField(op, pattern)
    if (directWrapped) return directWrapped
  }

  return op
}

export const resolveFuzzyFieldValues = (
  ops: JsonPatchOp[],
  content: string,
  patterns: FuzzyFieldPattern[]
): ResolveResult => {
  const resolved: JsonPatchOp[] = []
  for (const op of ops) {
    const wrapped = autoFuzzyFieldValue(op, patterns)
    const result = resolveOpFuzzyValue(wrapped, content)
    if (!result.ok) return { ok: false, error: result.error }
    resolved.push(result.op)
  }
  return { ok: true, ops: resolved }
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const isValueOp = (op: JsonPatchOp): op is ValueOp => op.op === "add" || op.op === "replace"

const wrapFuzzy = (text: string): string => `FUZZY[[${text}]]`

const hasTextField = (v: unknown, field: string): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  field in v &&
  typeof (v as Record<string, unknown>)[field] === "string"

const wrapParentField = (op: ValueOp, pattern: FuzzyFieldPattern): ValueOp | null => {
  if (!pattern.parentRegex.test(op.path)) return null
  if (!hasTextField(op.value, pattern.field)) return null
  const text = (op.value as Record<string, unknown>)[pattern.field] as string
  if (hasFuzzyPatterns(text)) return null
  return {
    ...op,
    value: { ...(op.value as Record<string, unknown>), [pattern.field]: wrapFuzzy(text) },
  } as ValueOp
}

const wrapDirectField = (op: ValueOp, pattern: FuzzyFieldPattern): ValueOp | null => {
  if (!pattern.directRegex.test(op.path)) return null
  if (typeof op.value !== "string") return null
  if (hasFuzzyPatterns(op.value)) return null
  return { ...op, value: wrapFuzzy(op.value) } as ValueOp
}

type FuzzyOpResult = { ok: true; op: JsonPatchOp } | { ok: false; error: string }

const containsUnresolvedFuzzy = (value: unknown): boolean => {
  if (typeof value === "string") return hasFuzzyPatterns(value)
  if (typeof value === "object" && value !== null)
    return Object.values(value).some((v) => typeof v === "string" && hasFuzzyPatterns(v))
  return false
}

const resolveOpFuzzyValue = (op: JsonPatchOp, content: string): FuzzyOpResult => {
  if (!isValueOp(op)) return { ok: true, op }

  if (typeof op.value === "string" && hasFuzzyPatterns(op.value)) {
    const { patch: resolved, unresolved } = resolveFuzzyPatterns(op.value, content)
    if (unresolved.length > 0) return { ok: false, error: `${op.path}: Text not found in document` }
    if (hasFuzzyPatterns(resolved)) {
      console.warn(`[fuzzy] unresolved FUZZY pattern leaked through at ${op.path}`)
      return { ok: false, error: `${op.path}: Text not found in document` }
    }
    return { ok: true, op: { ...op, value: resolved } as ValueOp as JsonPatchOp }
  }

  if (typeof op.value === "object" && op.value !== null) {
    const obj = op.value as Record<string, unknown>
    let changed = false
    const updated: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string" && hasFuzzyPatterns(val)) {
        const { patch: resolved, unresolved } = resolveFuzzyPatterns(val, content)
        if (unresolved.length > 0)
          return { ok: false, error: `${op.path}: Text not found in document` }
        updated[key] = resolved
        changed = true
      } else {
        updated[key] = val
      }
    }
    if (changed && containsUnresolvedFuzzy(updated)) {
      console.warn(`[fuzzy] unresolved FUZZY pattern leaked through at ${op.path}`)
      return { ok: false, error: `${op.path}: Text not found in document` }
    }
    return { ok: true, op: changed ? ({ ...op, value: updated } as ValueOp as JsonPatchOp) : op }
  }

  return { ok: true, op }
}
