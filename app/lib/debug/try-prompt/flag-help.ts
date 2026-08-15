import type { z } from "zod"
import type { ExtrasSchema, FlagMeta } from "./agents/types"

export interface FlagHelp {
  name: string
  placeholder: string
  required: boolean
  description: string
}

const DEFAULT_PLACEHOLDER = "<value>"

const isWrapper = (schema: z.ZodType): boolean =>
  schema.def.type === "optional" || schema.def.type === "default" || schema.def.type === "nullable"

const unwrap = (schema: z.ZodType): z.ZodType => {
  let inner = schema
  while (isWrapper(inner)) inner = (inner.def as unknown as { innerType: z.ZodType }).innerType
  return inner
}

const metaOf = (schema: z.ZodType): FlagMeta =>
  (schema.meta() ?? unwrap(schema).meta() ?? {}) as FlagMeta

const toFlagHelp = ([name, schema]: [string, z.ZodType]): FlagHelp => {
  const meta = metaOf(schema)
  return {
    name,
    placeholder: meta.placeholder ?? DEFAULT_PLACEHOLDER,
    required: schema.def.type !== "optional" && schema.def.type !== "default",
    description: meta.description ?? "",
  }
}

export const flagsOf = (schema: ExtrasSchema): FlagHelp[] =>
  Object.entries(schema.shape).map(([name, field]) => toFlagHelp([name, field as z.ZodType]))

export const renderFlagLines = (flags: FlagHelp[]): string[] => {
  const heads = flags.map((flag) => `--${flag.name} ${flag.placeholder}`)
  const width = Math.max(0, ...heads.map((head) => head.length))
  return flags.map(
    (flag, i) =>
      `  ${heads[i].padEnd(width)}  ${flag.required ? "required" : "optional"}  ${flag.description}`
  )
}
