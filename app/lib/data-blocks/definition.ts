import type { z } from "zod"
import type { ValidationError } from "./validate"

export interface IdPathConfig {
  path: string
  prefix: string
}

export interface ActorPathConfig {
  path: string
}

export interface IdRefExpansion {
  field: string
  prefix: string
  replaceWith: string
}

export interface ValidationContext {
  availableCodes: { id: string; name: string }[]
  availableTags: { id: string; label: string }[]
}

export interface AsyncValidationContext {
  path?: string
}

export interface BlockTypeConfig<T = unknown> {
  schema: (ctx?: ValidationContext) => z.ZodType<T>
  readonly: string[]
  immutable: Record<string, string>
  constraints: string[]
  renderer: "hidden" | "callout" | "chart"
  singleton: boolean
  projected?: boolean
  tableName?: string
  allowedFiles?: string[]
  labelKey?: string
  captionType?: string
  idPaths?: IdPathConfig[]
  actorPaths?: ActorPathConfig[]
  fuzzyFields?: string[]
  multilineFields?: string[]
  normalizeAsFile?: string[]
  patchSchema?: (schema: Record<string, unknown>) => Record<string, unknown>
  rowPath?: string
  expandIdRefs?: IdRefExpansion[]
  asyncValidate?: (parsed: T, context: AsyncValidationContext) => Promise<ValidationError[]>
  normalize?: (oldDoc: unknown, newDoc: unknown) => unknown
}
