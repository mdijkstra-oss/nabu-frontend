import type { z } from "zod"
import type { ValidationError } from "./validate"

export interface IdPathConfig {
  path: string
  prefix: string
}

export interface ActorPathConfig {
  path: string
}

// Replaces `#<id>` refs of `prefix` inside `field` with the `replaceWith` property of the entity
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
  // --- Shape ---

  // The shape and schema validation of the datablock as would be written in the document
  schema: (ctx?: ValidationContext) => z.ZodType<T>
  // Allows only one instance per document
  singleton: boolean
  // Rules the schema cannot express, handed to the model as prose
  constraints: string[]
  // Validation needing the corpus or the database, run once the schema passes
  asyncValidate?: (parsed: T, context: AsyncValidationContext) => Promise<ValidationError[]>

  // --- What the agent may modify ---

  // Fields stripped from the schema the model sees — written by us, not by the agent
  readonly: string[]
  // Fields that cannot change once set, mapped to the error shown when they do (id is always one)
  immutable: Record<string, string>
  // Limits blocks to certain files (allows settings blocks to only exist in settings.hidden.md file)
  allowedFiles?: string[]
  // Adjusts the model-facing schema for patch tools, where full-object rules do not apply
  patchSchema?: (schema: Record<string, unknown>) => Record<string, unknown>

  // --- Rendering ---

  // Which render function to call when displaying
  renderer: "hidden" | "callout" | "chart"
  // Path to the human-readable label used when listing blocks back to the agent
  labelKey?: string
  // Prefix for the generated caption below the block, e.g. "Figure"
  captionType?: string

  // --- SQL projection ---

  // When true, becomes a table named after the language minus its `json-` prefix, shaped after schema
  projected?: boolean
  // Override table name
  tableName?: string
  // Projects this array field as the table's rows instead of the block itself
  rowPath?: string
  // Columns kept in the table but hidden from the schema the agent is shown
  hiddenColumns?: string[]

  // --- Where a row sits in the document ---

  // Row field holding text quoted from the prose, located to give the row its span
  spanField?: string

  // --- Identity and cross-references ---

  // Paths holding entity ids, and what kind of entity each id names
  idPaths?: IdPathConfig[]
  // Paths stamped with "ai" or "user" on write, and hidden from the model's schema
  actorPaths?: ActorPathConfig[]
  // Inlines referenced entities into a field's text on write, so it reads without the reference
  expandIdRefs?: IdRefExpansion[]

  // --- Normalization on write ---

  // Paths matched approximately when patching, for values the agent quotes from the document
  fuzzyFields?: string[]
  // String fields normalized the same way file content is
  normalizeAsFile?: string[]
  // Reconciles the patched document against the original, after a patch tool applies
  normalize?: (oldDoc: unknown, newDoc: unknown) => unknown
}
