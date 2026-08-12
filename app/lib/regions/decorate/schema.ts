import { z } from "zod"
import { regionKinds, type RegionValueType } from "~/lib/regions/kinds/registry"

export const INFERRED_META = "inferred_meta"

export interface DateSpan {
  start: string
  end: string
}

export type InferredMetaValue = string[] | DateSpan

export type InferredMeta = Record<string, InferredMetaValue>

const dateSpanSchema = z.object({ start: z.iso.datetime(), end: z.iso.datetime() })

// Total over the value-type union: a third value type fails typecheck here until a
// reducer and a column type exist for it.
const VALUE_TYPE_SCHEMAS: Record<RegionValueType, z.ZodType> = {
  string: z.array(z.string()),
  datetime: dateSpanSchema,
}

const buildFragment = (): z.ZodType =>
  z
    .object(
      Object.fromEntries(
        regionKinds().map((kind) => [kind.id, VALUE_TYPE_SCHEMAS[kind.valueType].optional()])
      )
    )
    .optional()

let fragment: z.ZodType | null = null

export const inferredMetaSchema = (): z.ZodType => {
  if (!fragment) fragment = buildFragment()
  return fragment
}
