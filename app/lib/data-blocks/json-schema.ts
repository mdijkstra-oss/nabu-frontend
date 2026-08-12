import { z } from "zod"
import { parsePath, type ParsedPath } from "./json"
import type { BlockTypeConfig, ActorPathConfig } from "./definition"

type JsonSchema = Record<string, unknown>

export interface BlockSchemaDefinition {
  language: string
  jsonSchema: unknown
  singleton: boolean
  immutable: string[]
  constraints: string[]
}

export const modifySchemaAtPath = (
  schema: JsonSchema,
  path: string[],
  modify: (target: JsonSchema) => JsonSchema
): JsonSchema => {
  if (path.length === 0) return modify(schema)
  const [head, ...rest] = path
  const child = schema[head]
  if (typeof child !== "object" || child === null) return schema
  return { ...schema, [head]: modifySchemaAtPath(child as JsonSchema, rest, modify) }
}

export const removeFromProperties = (
  schema: JsonSchema,
  path: string[],
  field: string
): JsonSchema =>
  modifySchemaAtPath(schema, path, (target) => {
    const props = target.properties as Record<string, unknown> | undefined
    if (!props || !(field in props)) return target
    const { [field]: _, ...rest } = props
    return { ...target, properties: rest }
  })

export const removeFromRequired = (
  schema: JsonSchema,
  path: string[],
  fields: string[]
): JsonSchema =>
  modifySchemaAtPath(schema, path, (target) => {
    const required = target.required as string[] | undefined
    if (!required) return target
    return { ...target, required: required.filter((f) => !fields.includes(f)) }
  })

const schemaPathOf = (parsed: ParsedPath): string[] => {
  if (parsed.type === "root") return []
  if (parsed.type === "root-array") return ["items"]
  return ["properties", parsed.arrayField, "items"]
}

const stripAtPath = (schema: JsonSchema, path: string): JsonSchema => {
  const parsed = parsePath(path)
  if (!parsed) return schema
  const field = parsed.type === "root" ? parsed.field : parsed.itemField
  return removeFromProperties(schema, schemaPathOf(parsed), field)
}

const stripActorFields = (schema: JsonSchema, actorPaths: ActorPathConfig[]): JsonSchema =>
  actorPaths.reduce((s, { path }) => stripAtPath(s, path), schema)

const stripReadonlyFields = (schema: JsonSchema, paths: string[]): JsonSchema =>
  paths.reduce(stripAtPath, schema)

export const toBlockSchema = (config: BlockTypeConfig): unknown => {
  let schema = z.toJSONSchema(config.schema(), { io: "input" }) as JsonSchema
  if (config.patchSchema) schema = config.patchSchema(schema)
  if (config.actorPaths?.length) schema = stripActorFields(schema, config.actorPaths)
  if (config.readonly.length > 0) schema = stripReadonlyFields(schema, config.readonly)
  return schema
}
