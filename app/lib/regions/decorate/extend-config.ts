import { z } from "zod"
import type { BlockTypeConfig, ValidationContext } from "~/lib/data-blocks/definition"
import { INFERRED_META, inferredMetaSchema } from "./schema"

type AnyObject = z.ZodObject<Record<string, z.ZodType>>

const extendRoot = (schema: z.ZodType): z.ZodType =>
  (schema as AnyObject).extend({ [INFERRED_META]: inferredMetaSchema() })

const extendRow = (schema: z.ZodType, rowPath: string): z.ZodType => {
  const object = schema as AnyObject
  const array = object.shape[rowPath] as z.ZodArray<z.ZodType>
  const element = extendRoot(array.element)
  return object.extend({ [rowPath]: z.array(element) })
}

// A projected block restricted to a file with no prose can only ever produce null
// decorated columns, so it is left alone rather than given columns nothing fills.
const isDecorated = (config: BlockTypeConfig): boolean =>
  config.projected === true && config.allowedFiles === undefined

export const readonlyPathFor = (config: BlockTypeConfig): string =>
  config.rowPath ? `${config.rowPath}.*.${INFERRED_META}` : INFERRED_META

// One wrapper composes the field into every decorated block type, so no definition
// restates it and a new block type is decorated by being registered.
export const withInferredMeta = (config: BlockTypeConfig): BlockTypeConfig => {
  if (!isDecorated(config)) return config
  const rowPath = config.rowPath
  return {
    ...config,
    schema: (ctx?: ValidationContext) => {
      const declared = config.schema(ctx)
      return rowPath ? extendRow(declared, rowPath) : extendRoot(declared)
    },
    readonly: [...config.readonly, readonlyPathFor(config)],
  }
}
