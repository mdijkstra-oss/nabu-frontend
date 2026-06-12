import type { JsonPatchOp } from "./apply"
import { findMatchOffset } from "~/lib/text/find"
import { stripMarkdown } from "~/lib/text/strip"

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

export const resolveFuzzyFieldValues = (
  ops: JsonPatchOp[],
  content: string,
  patterns: FuzzyFieldPattern[]
): ResolveResult => {
  const resolved: JsonPatchOp[] = []
  for (const op of ops) {
    const result = resolveOpAgainstPatterns(op, content, patterns)
    if (!result.ok) return { ok: false, error: result.error }
    resolved.push(result.op)
  }
  return { ok: true, ops: resolved }
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const isValueOp = (op: JsonPatchOp): op is ValueOp => op.op === "add" || op.op === "replace"

const hasTextField = (v: unknown, field: string): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  field in v &&
  typeof (v as Record<string, unknown>)[field] === "string"

const resolveAgainstProse = (content: string, value: string): string | null => {
  const offset = findMatchOffset(content, value)
  return offset ? stripMarkdown(content.slice(offset.start, offset.end)) : null
}

type OpResult = { ok: true; op: JsonPatchOp } | { ok: false; error: string }

const resolveOpAgainstPatterns = (
  op: JsonPatchOp,
  content: string,
  patterns: FuzzyFieldPattern[]
): OpResult => {
  if (!isValueOp(op)) return { ok: true, op }

  for (const pattern of patterns) {
    const parentResolved = resolveParentField(op, content, pattern)
    if (parentResolved) return parentResolved

    const directResolved = resolveDirectField(op, content, pattern)
    if (directResolved) return directResolved
  }

  return { ok: true, op }
}

const resolveParentField = (
  op: ValueOp,
  content: string,
  pattern: FuzzyFieldPattern
): OpResult | null => {
  if (!pattern.parentRegex.test(op.path)) return null
  if (!hasTextField(op.value, pattern.field)) return null
  const raw = (op.value as Record<string, unknown>)[pattern.field] as string
  const resolved = resolveAgainstProse(content, raw)
  if (resolved === null) return { ok: false, error: `${op.path}: Text not found in document` }
  return {
    ok: true,
    op: {
      ...op,
      value: { ...(op.value as Record<string, unknown>), [pattern.field]: resolved },
    } as ValueOp,
  }
}

const resolveDirectField = (
  op: ValueOp,
  content: string,
  pattern: FuzzyFieldPattern
): OpResult | null => {
  if (!pattern.directRegex.test(op.path)) return null
  if (typeof op.value !== "string") return null
  const resolved = resolveAgainstProse(content, op.value)
  if (resolved === null) return { ok: false, error: `${op.path}: Text not found in document` }
  return { ok: true, op: { ...op, value: resolved } as ValueOp }
}
