import { z } from "zod"
import type { Handler, HandlerResult, RawFiles, Operation } from "../types"

interface ToolDef<TSchema extends z.ZodType, TOutput> {
  name: string
  description: string
  schema: TSchema
  jsonSchema?: unknown
  handler: (files: RawFiles, args: z.infer<TSchema>) => Promise<HandlerResult<TOutput>>
}

type Tool<TSchema extends z.ZodType, TOutput> = ToolDef<TSchema, TOutput> & {
  handle: Handler<TOutput>
}

export interface AnyTool {
  name: string
  description: string
  schema: z.ZodType
  jsonSchema?: unknown
}

export const tool = <TSchema extends z.ZodType, TOutput>(
  def: ToolDef<TSchema, TOutput>
): Tool<TSchema, TOutput> => {
  const handle: Handler<TOutput> = async (files, args) => {
    const parsed = def.schema.safeParse(args)
    if (!parsed.success) {
      return {
        status: "error",
        output: formatZodError(parsed.error),
        mutations: [],
      }
    }
    return def.handler(files, parsed.data)
  }

  return { ...def, handle }
}

export const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join(", ")

interface JsonSchemaProperty {
  type: string
  description?: string
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  enum?: string[]
  oneOf?: JsonSchemaProperty[]
  const?: unknown
}

export interface ToolDefinition {
  type: "function"
  name: string
  description: string
  strict?: true
  parameters: {
    type: "object"
    properties: Record<string, JsonSchemaProperty>
    required: string[]
    additionalProperties?: false
  }
}

export { toStrictSchema, isStrictCompatible } from "./strict-schema"
import { toStrictSchema, isStrictCompatible } from "./strict-schema"

const UNSUPPORTED_KEYWORDS = new Set(["propertyNames", "patternProperties"])

export const stripUnsupportedKeywords = (schema: unknown): unknown => {
  if (typeof schema !== "object" || schema === null) return schema
  if (Array.isArray(schema)) return schema.map(stripUnsupportedKeywords)
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue
    cleaned[key] = stripUnsupportedKeywords(value)
  }
  return cleaned
}

export const toToolDefinition = (t: AnyTool): ToolDefinition => {
  const jsonSchema = stripUnsupportedKeywords(
    t.jsonSchema ?? z.toJSONSchema(t.schema, { io: "input" })
  )
  const strict = isStrictCompatible(jsonSchema)
  const parameters = strict
    ? (toStrictSchema(jsonSchema) as ToolDefinition["parameters"])
    : {
        type: "object" as const,
        properties: {
          ...(((jsonSchema as Record<string, unknown>).properties as Record<
            string,
            JsonSchemaProperty
          >) ?? {}),
        },
        required: [...(((jsonSchema as Record<string, unknown>).required as string[]) ?? [])],
      }
  return {
    type: "function",
    name: t.name,
    description: t.description,
    ...(strict
      ? { strict: true, parameters: { ...parameters, additionalProperties: false as const } }
      : { parameters }),
  }
}

const registry: Tool<z.ZodType, unknown>[] = []

export const registerTool = <TSchema extends z.ZodType, TOutput>(
  t: Tool<TSchema, TOutput>
): Tool<TSchema, TOutput> => {
  registry.push(t as Tool<z.ZodType, unknown>)
  return t
}

export const getToolHandlers = (): Record<string, Handler> =>
  Object.fromEntries(registry.map((t) => [t.name, t.handle]))

export const toSchemaMap = (tools: AnyTool[]): Record<string, z.ZodType> =>
  Object.fromEntries(tools.map((t) => [t.name, t.schema]))

export const ok = <T>(output: T, mutations: Operation[] = []): HandlerResult<T> => ({
  status: "ok",
  output,
  mutations,
})

export const partial = <T>(
  output: T,
  message: string,
  mutations: Operation[] = []
): HandlerResult<T> => ({
  status: "partial",
  output,
  message,
  mutations,
})

export const err = (output: string): HandlerResult<never> => ({
  status: "error",
  output,
  mutations: [],
})

export const withHint = <T>(result: HandlerResult<T>, hint: string | null): HandlerResult<T> =>
  hint ? { ...result, hint } : result
