import { describe, it, expect } from "vitest"
import { extractRows } from "./extract"
import type { JsonSchema } from "./types"

describe("extractRows", () => {
  const cases: {
    name: string
    tableName: string
    schema: JsonSchema
    data: unknown
    filename: string
    expected: unknown
  }[] = [
    {
      name: "flat object extracts single row",
      tableName: "callouts",
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          collapsed: { type: "boolean" },
        },
        required: ["id", "title", "collapsed"],
      },
      data: { id: "abc", title: "Hello", collapsed: true },
      filename: "doc.md",
      expected: [
        {
          table: "callouts",
          rows: [{ file: "doc.md", id: "abc", title: "Hello", collapsed: true }],
        },
      ],
    },
    {
      name: "missing optional fields become null",
      tableName: "callouts",
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          actor: { type: "string" },
        },
        required: ["id"],
      },
      data: { id: "abc" },
      filename: "doc.md",
      expected: [
        {
          table: "callouts",
          rows: [{ file: "doc.md", id: "abc", actor: null }],
        },
      ],
    },
    {
      name: "array of strings kept as array value",
      tableName: "attributes",
      schema: {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
        },
      },
      data: { tags: ["a", "b"] },
      filename: "doc.md",
      expected: [
        {
          table: "attributes",
          rows: [{ file: "doc.md", tags: ["a", "b"] }],
        },
      ],
    },
    {
      name: "array of objects creates child table",
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
      data: {
        tags: [
          { id: "t1", label: "foo" },
          { id: "t2", label: "bar" },
        ],
      },
      filename: "settings.hidden.md",
      expected: [
        {
          table: "settings",
          rows: [{ file: "settings.hidden.md" }],
        },
        {
          table: "settings_tags",
          rows: [
            { file: "settings.hidden.md", id: "t1", label: "foo" },
            { file: "settings.hidden.md", id: "t2", label: "bar" },
          ],
        },
      ],
    },
    {
      name: "empty array of objects produces no child rows",
      tableName: "settings",
      schema: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          },
        },
      },
      data: { tags: [] },
      filename: "doc.md",
      expected: [
        {
          table: "settings",
          rows: [{ file: "doc.md" }],
        },
      ],
    },
    {
      name: "undefined array of objects produces no child rows",
      tableName: "settings",
      schema: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          },
        },
      },
      data: {},
      filename: "doc.md",
      expected: [
        {
          table: "settings",
          rows: [{ file: "doc.md" }],
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
      data: {
        tags: ["x"],
        annotations: [{ text: "hi", color: "red" }],
      },
      filename: "doc.md",
      expected: [
        {
          table: "attributes",
          rows: [{ file: "doc.md", tags: ["x"] }],
        },
        {
          table: "attributes_annotations",
          rows: [{ file: "doc.md", text: "hi", color: "red" }],
        },
      ],
    },
    {
      name: "nested object flattens into prefixed keys",
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
              removalJustification: { type: "string" },
            },
          },
        },
      },
      data: {
        text: "hello",
        vote: {
          find: { found: 3, missed: 0 },
          filter: { keep: 2, remove: 1 },
          removalJustification: "weak evidence",
        },
      },
      filename: "doc.md",
      expected: [
        {
          table: "annotations",
          rows: [
            {
              file: "doc.md",
              text: "hello",
              vote_find_found: 3,
              vote_find_missed: 0,
              vote_filter_keep: 2,
              vote_filter_remove: 1,
              vote_removalJustification: "weak evidence",
            },
          ],
        },
      ],
    },
    {
      name: "missing nested object produces null leaves",
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
            },
          },
        },
      },
      data: { text: "hello" },
      filename: "doc.md",
      expected: [
        {
          table: "annotations",
          rows: [
            {
              file: "doc.md",
              text: "hello",
              vote_find_found: null,
              vote_find_missed: null,
            },
          ],
        },
      ],
    },
    {
      name: "child table items with nested objects flatten",
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
      data: {
        annotations: [{ text: "hi", vote: { score: 5 } }, { text: "bye" }],
      },
      filename: "doc.md",
      expected: [
        {
          table: "attributes",
          rows: [{ file: "doc.md" }],
        },
        {
          table: "attributes_annotations",
          rows: [
            { file: "doc.md", text: "hi", vote_score: 5 },
            { file: "doc.md", text: "bye", vote_score: null },
          ],
        },
      ],
    },
  ]

  it.each(cases)("$name", ({ tableName, schema, data, filename, expected }) => {
    expect(extractRows(tableName, schema, data, filename)).toEqual(expected)
  })
})
