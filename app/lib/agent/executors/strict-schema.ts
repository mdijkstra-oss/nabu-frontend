const isObjectWithProperties = (s: Record<string, unknown>): boolean =>
  s.type === "object" && typeof s.properties === "object" && s.properties !== null

// A record schema: additionalProperties carrying a value schema instead of a
// boolean. Strict mode cannot express arbitrary keys — OpenAI rejects the
// form — so any schema containing one must be sent non-strict.
const isRecordSchema = (s: Record<string, unknown>): boolean =>
  s.type === "object" &&
  typeof s.additionalProperties === "object" &&
  s.additionalProperties !== null

export const isStrictCompatible = (schema: unknown): boolean => {
  if (typeof schema !== "object" || schema === null) return true
  const s = schema as Record<string, unknown>
  const keys = Object.keys(s).filter((k) => k !== "$schema")
  if (keys.length === 0 || (keys.length === 1 && keys[0] === "description")) return false

  if (isRecordSchema(s)) return false

  if (s.type === "array" && s.items) return isStrictCompatible(s.items)

  if (s.type === "object" && typeof s.properties === "object" && s.properties !== null) {
    return Object.values(s.properties as Record<string, unknown>).every(isStrictCompatible)
  }

  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(s[key])) return (s[key] as unknown[]).every(isStrictCompatible)
  }

  return true
}

const NUMERIC_BOUND_KEYS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
])

// Anthropic's structured output rejects numeric bounds on number and integer
// schemas with a 400. Bounds only steer the model; the local parse still
// enforces them.
export const dropNumericBounds = (schema: unknown): unknown => {
  if (typeof schema !== "object" || schema === null) return schema
  const s = Object.fromEntries(
    Object.entries(schema as Record<string, unknown>).filter(
      ([key]) => !NUMERIC_BOUND_KEYS.has(key)
    )
  )
  if (s.items) s.items = dropNumericBounds(s.items)
  if (typeof s.properties === "object" && s.properties !== null) {
    s.properties = Object.fromEntries(
      Object.entries(s.properties as Record<string, unknown>).map(([key, prop]) => [
        key,
        dropNumericBounds(prop),
      ])
    )
  }
  if (typeof s.additionalProperties === "object" && s.additionalProperties !== null) {
    s.additionalProperties = dropNumericBounds(s.additionalProperties)
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(s[key])) s[key] = (s[key] as unknown[]).map(dropNumericBounds)
  }
  return s
}

export const toStrictSchema = (schema: unknown): unknown => {
  if (typeof schema !== "object" || schema === null) return schema
  const { $schema: _, ...s } = schema as Record<string, unknown>

  if ("const" in s) {
    const { const: value, ...rest } = s
    return { ...rest, enum: [value] }
  }

  if (s.type === "array" && s.items) {
    return { ...s, items: toStrictSchema(s.items) }
  }

  if (isObjectWithProperties(s)) {
    const properties = s.properties as Record<string, unknown>
    const originalRequired = new Set(Array.isArray(s.required) ? (s.required as string[]) : [])
    const allKeys = Object.keys(properties)

    const wrapOptional = (key: string, prop: unknown): unknown =>
      originalRequired.has(key) ? prop : { anyOf: [prop, { type: "null" }] }

    const strictProperties = Object.fromEntries(
      allKeys.map((key) => [key, wrapOptional(key, toStrictSchema(properties[key]))])
    )

    return { ...s, properties: strictProperties, required: allKeys, additionalProperties: false }
  }

  if (Array.isArray(s.oneOf)) {
    const { oneOf: _, ...rest } = s
    return { ...rest, anyOf: (s.oneOf as unknown[]).map(toStrictSchema) }
  }

  for (const key of ["anyOf", "allOf"]) {
    if (Array.isArray(s[key])) {
      return { ...s, [key]: (s[key] as unknown[]).map(toStrictSchema) }
    }
  }

  return s
}
