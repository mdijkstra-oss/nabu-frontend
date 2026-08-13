import { describe, expect, it } from "vitest"
import { toStrictSchema, isStrictCompatible, stripUnsupportedKeywords } from "./tool"
import { dropNumericBounds } from "./strict-schema"

describe("toStrictSchema", () => {
  const cases = [
    {
      name: "passes through primitives",
      input: { type: "string", description: "a name" },
      expected: { type: "string", description: "a name" },
    },
    {
      name: "strips $schema",
      input: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string" },
      expected: { type: "string" },
    },
    {
      name: "makes optional properties required with null union",
      input: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      expected: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
        required: ["name", "age"],
        additionalProperties: false,
      },
    },
    {
      name: "recurses into array items",
      input: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
      expected: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { anyOf: [{ type: "string" }, { type: "null" }] },
            label: { type: "string" },
          },
          required: ["id", "label"],
          additionalProperties: false,
        },
      },
    },
    {
      name: "recurses into nested objects",
      input: {
        type: "object",
        properties: {
          meta: {
            type: "object",
            properties: {
              tag: { type: "string" },
              opt: { type: "number" },
            },
            required: ["tag"],
            additionalProperties: false,
          },
        },
        required: ["meta"],
        additionalProperties: false,
      },
      expected: {
        type: "object",
        properties: {
          meta: {
            type: "object",
            properties: {
              tag: { type: "string" },
              opt: { anyOf: [{ type: "number" }, { type: "null" }] },
            },
            required: ["tag", "opt"],
            additionalProperties: false,
          },
        },
        required: ["meta"],
        additionalProperties: false,
      },
    },
    {
      name: "adds additionalProperties false when missing",
      input: {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      },
      expected: {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: false,
      },
    },
    {
      name: "converts const to single-element enum",
      input: { const: "create_file", type: "string", description: "op type" },
      expected: { enum: ["create_file"], type: "string", description: "op type" },
    },
    {
      name: "handles object with no required array",
      input: {
        type: "object",
        properties: { x: { type: "boolean" } },
        additionalProperties: false,
      },
      expected: {
        type: "object",
        properties: { x: { anyOf: [{ type: "boolean" }, { type: "null" }] } },
        required: ["x"],
        additionalProperties: false,
      },
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(toStrictSchema(input)).toEqual(expected)
  })
})

describe("isStrictCompatible", () => {
  const cases = [
    {
      name: "accepts a plain object schema",
      input: {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      },
      expected: true,
    },
    {
      name: "rejects a record schema",
      input: {
        type: "object",
        additionalProperties: { type: "array", items: { type: "string" } },
      },
      expected: false,
    },
    {
      name: "rejects a record schema nested in a property",
      input: {
        type: "object",
        properties: {
          inclusions: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } },
          },
        },
        required: ["inclusions"],
      },
      expected: false,
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(isStrictCompatible(input)).toBe(expected)
  })
})

describe("dropNumericBounds", () => {
  const cases = [
    {
      name: "drops bounds from an integer property",
      input: {
        type: "object",
        properties: { id: { type: "integer", minimum: 1, maximum: 10 } },
        required: ["id"],
      },
      expected: {
        type: "object",
        properties: { id: { type: "integer" } },
        required: ["id"],
      },
    },
    {
      name: "drops bounds inside array items and unions",
      input: {
        type: "array",
        items: {
          anyOf: [{ type: "number", exclusiveMinimum: 0, multipleOf: 2 }, { type: "null" }],
        },
      },
      expected: {
        type: "array",
        items: { anyOf: [{ type: "number" }, { type: "null" }] },
      },
    },
    {
      name: "keeps a property named like a bound keyword",
      input: {
        type: "object",
        properties: { minimum: { type: "string" } },
        required: ["minimum"],
      },
      expected: {
        type: "object",
        properties: { minimum: { type: "string" } },
        required: ["minimum"],
      },
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(dropNumericBounds(input)).toEqual(expected)
  })
})

describe("stripUnsupportedKeywords", () => {
  const cases = [
    {
      name: "passes through primitives",
      input: { type: "string" },
      expected: { type: "string" },
    },
    {
      name: "strips propertyNames from record schema",
      input: {
        type: "object",
        propertyNames: { type: "string" },
        additionalProperties: { type: "array", items: { type: "string" } },
      },
      expected: {
        type: "object",
        additionalProperties: { type: "array", items: { type: "string" } },
      },
    },
    {
      name: "strips patternProperties",
      input: {
        type: "object",
        patternProperties: { "^S_": { type: "string" } },
        properties: { name: { type: "string" } },
      },
      expected: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    },
    {
      name: "recurses into nested properties",
      input: {
        type: "object",
        properties: {
          hydes: {
            anyOf: [
              {
                type: "object",
                propertyNames: { type: "string" },
                additionalProperties: { type: "array", items: { type: "string" } },
              },
              { type: "null" },
            ],
          },
        },
      },
      expected: {
        type: "object",
        properties: {
          hydes: {
            anyOf: [
              {
                type: "object",
                additionalProperties: { type: "array", items: { type: "string" } },
              },
              { type: "null" },
            ],
          },
        },
      },
    },
    {
      name: "handles arrays",
      input: [{ type: "object", propertyNames: { type: "string" } }],
      expected: [{ type: "object" }],
    },
    {
      name: "returns non-objects unchanged",
      input: "string",
      expected: "string",
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(stripUnsupportedKeywords(input)).toEqual(expected)
  })
})
