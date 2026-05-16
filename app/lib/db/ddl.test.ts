import { describe, it, expect } from "vitest"
import { jsonSchemaToTableProjection, tableSchemaToDdl, tableSchemaToDescribe } from "./ddl"
import type { JsonSchema } from "./types"

describe("jsonSchemaToTableProjection", () => {
  const cases: { name: string; tableName: string; schema: JsonSchema; expectedSchemas: unknown }[] =
    [
      {
        name: "flat object with all scalar types",
        tableName: "items",
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            active: { type: "boolean" },
            count: { type: "integer" },
          },
          required: ["name", "active"],
        },
        expectedSchemas: [
          {
            name: "items",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "name", type: "VARCHAR", nullable: true },
              { name: "active", type: "BOOLEAN", nullable: true },
              { name: "count", type: "INTEGER", nullable: true },
            ],
          },
        ],
      },
      {
        name: "array of strings becomes VARCHAR[]",
        tableName: "doc",
        schema: {
          type: "object",
          properties: {
            tags: { type: "array", items: { type: "string" } },
          },
        },
        expectedSchemas: [
          {
            name: "doc",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "tags", type: "VARCHAR[]", nullable: true },
            ],
          },
        ],
      },
      {
        name: "array of objects becomes child table",
        tableName: "settings",
        schema: {
          type: "object",
          properties: {
            tags: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                },
                required: ["id", "label"],
              },
            },
          },
        },
        expectedSchemas: [
          {
            name: "settings",
            columns: [{ name: "file", type: "VARCHAR", nullable: false }],
          },
          {
            name: "settings_tags",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "id", type: "VARCHAR", nullable: true },
              { name: "label", type: "VARCHAR", nullable: true },
            ],
          },
        ],
      },
      {
        name: "mixed scalars and child tables",
        tableName: "attributes",
        schema: {
          type: "object",
          properties: {
            tags: { type: "array", items: { type: "string" } },
            annotations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  color: { type: "string" },
                },
                required: ["text"],
              },
            },
          },
        },
        expectedSchemas: [
          {
            name: "attributes",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "tags", type: "VARCHAR[]", nullable: true },
            ],
          },
          {
            name: "attributes_annotations",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "text", type: "VARCHAR", nullable: true },
              { name: "color", type: "VARCHAR", nullable: true },
            ],
          },
        ],
      },
      {
        name: "array of numbers becomes FLOAT[]",
        tableName: "embeddings",
        schema: {
          type: "object",
          properties: {
            embedding: { type: "array", items: { type: "number" } },
          },
        },
        expectedSchemas: [
          {
            name: "embeddings",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "embedding", type: "FLOAT[]", nullable: true },
            ],
          },
        ],
      },
      {
        name: "string with format date becomes DATE",
        tableName: "attributes",
        schema: {
          type: "object",
          properties: {
            date: { type: "string", format: "date" },
          },
        },
        expectedSchemas: [
          {
            name: "attributes",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "date", type: "DATE", nullable: true },
            ],
          },
        ],
      },
      {
        name: "plain string without format stays VARCHAR",
        tableName: "attributes",
        schema: {
          type: "object",
          properties: {
            subject: { type: "string" },
          },
        },
        expectedSchemas: [
          {
            name: "attributes",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "subject", type: "VARCHAR", nullable: true },
            ],
          },
        ],
      },
      {
        name: "string with unknown format falls back to VARCHAR",
        tableName: "items",
        schema: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
          },
        },
        expectedSchemas: [
          {
            name: "items",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "email", type: "VARCHAR", nullable: true },
            ],
          },
        ],
      },
      {
        name: "no properties produces file-only table",
        tableName: "empty",
        schema: { type: "object" },
        expectedSchemas: [
          {
            name: "empty",
            columns: [{ name: "file", type: "VARCHAR", nullable: false }],
          },
        ],
      },
      {
        name: "nested object flattens into prefixed columns",
        tableName: "annotations",
        schema: {
          type: "object",
          properties: {
            text: { type: "string" },
            vote: {
              type: "object",
              properties: {
                find: {
                  type: "object",
                  properties: {
                    found: { type: "integer" },
                    missed: { type: "integer" },
                  },
                },
                filter: {
                  type: "object",
                  properties: {
                    keep: { type: "integer" },
                    remove: { type: "integer" },
                  },
                },
                review: { type: "string" },
              },
            },
          },
        },
        expectedSchemas: [
          {
            name: "annotations",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "text", type: "VARCHAR", nullable: true },
              { name: "vote_find_found", type: "INTEGER", nullable: true },
              { name: "vote_find_missed", type: "INTEGER", nullable: true },
              { name: "vote_filter_keep", type: "INTEGER", nullable: true },
              { name: "vote_filter_remove", type: "INTEGER", nullable: true },
              { name: "vote_review", type: "VARCHAR", nullable: true },
            ],
          },
        ],
      },
      {
        name: "object without properties stays VARCHAR",
        tableName: "items",
        schema: {
          type: "object",
          properties: {
            meta: { type: "object" },
          },
        },
        expectedSchemas: [
          {
            name: "items",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "meta", type: "VARCHAR", nullable: true },
            ],
          },
        ],
      },
      {
        name: "child table items with nested objects flatten inside child",
        tableName: "attributes",
        schema: {
          type: "object",
          properties: {
            annotations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  vote: {
                    type: "object",
                    properties: {
                      score: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
        expectedSchemas: [
          {
            name: "attributes",
            columns: [{ name: "file", type: "VARCHAR", nullable: false }],
          },
          {
            name: "attributes_annotations",
            columns: [
              { name: "file", type: "VARCHAR", nullable: false },
              { name: "text", type: "VARCHAR", nullable: true },
              { name: "vote_score", type: "INTEGER", nullable: true },
            ],
          },
        ],
      },
    ]

  it.each(cases)("$name", ({ tableName, schema, expectedSchemas }) => {
    const result = jsonSchemaToTableProjection(tableName, schema)
    expect(result.schemas).toEqual(expectedSchemas)
  })
})

describe("tableSchemaToDdl", () => {
  const cases = [
    {
      name: "simple table with mixed nullability",
      schema: {
        name: "items",
        columns: [
          { name: "file", type: "VARCHAR" as const, nullable: false },
          { name: "name", type: "VARCHAR" as const, nullable: false },
          { name: "count", type: "INTEGER" as const, nullable: true },
        ],
      },
      expected: [
        "CREATE OR REPLACE TABLE items (",
        "  file VARCHAR NOT NULL,",
        "  name VARCHAR NOT NULL,",
        "  count INTEGER",
        ");",
      ].join("\n"),
    },
    {
      name: "table with LIST column",
      schema: {
        name: "doc",
        columns: [
          { name: "file", type: "VARCHAR" as const, nullable: false },
          { name: "tags", type: "VARCHAR[]" as const, nullable: true },
        ],
      },
      expected: [
        "CREATE OR REPLACE TABLE doc (",
        "  file VARCHAR NOT NULL,",
        "  tags VARCHAR[]",
        ");",
      ].join("\n"),
    },
  ]

  it.each(cases)("$name", ({ schema, expected }) => {
    expect(tableSchemaToDdl(schema)).toBe(expected)
  })
})

describe("tableSchemaToDescribe", () => {
  const cases = [
    {
      name: "simple table with mixed nullability",
      schema: {
        name: "items",
        columns: [
          { name: "file", type: "VARCHAR" as const, nullable: false },
          { name: "name", type: "VARCHAR" as const, nullable: false },
          { name: "count", type: "INTEGER" as const, nullable: true },
        ],
      },
      expected: [
        "items",
        "  file VARCHAR NOT NULL",
        "  name VARCHAR NOT NULL",
        "  count INTEGER",
      ].join("\n"),
    },
    {
      name: "table with LIST column",
      schema: {
        name: "doc",
        columns: [
          { name: "file", type: "VARCHAR" as const, nullable: false },
          { name: "tags", type: "VARCHAR[]" as const, nullable: true },
        ],
      },
      expected: ["doc", "  file VARCHAR NOT NULL", "  tags VARCHAR[]"].join("\n"),
    },
  ]

  it.each(cases)("$name", ({ schema, expected }) => {
    expect(tableSchemaToDescribe(schema)).toBe(expected)
  })
})
