import { describe, it, expect } from "vitest"
import { translateOps } from "./translate"
import type { TypedOpsSpec } from "./derive"
import type { JsonPatchOp } from "~/lib/patch/structured-json/apply"

const annotationsSpec: TypedOpsSpec = {
  language: "json-annotations",
  shortName: "annotations",
  singleton: true,
  setFieldsSchema: { type: "object", properties: {} },
  arrayOps: [
    {
      fieldName: "annotations",
      singularName: "annotation",
      itemSchema: {},
      matchKey: "id",
      partialItemSchema: {},
    },
  ],
  multilineFields: [],
  immutableFields: [],
  fuzzyFields: ["annotations.*.text"],
}

const calloutSpec: TypedOpsSpec = {
  language: "json-callout",
  shortName: "callout",
  singleton: false,
  setFieldsSchema: {
    type: "object",
    properties: { color: { type: "string" }, title: { type: "string" } },
  },
  arrayOps: [],
  multilineFields: [],
  immutableFields: ["id"],
  fuzzyFields: [],
}

const settingsSpec: TypedOpsSpec = {
  language: "json-settings",
  shortName: "settings",
  singleton: true,
  setFieldsSchema: { type: "object", properties: {} },
  arrayOps: [
    {
      fieldName: "tags",
      singularName: "tag",
      itemSchema: {},
      matchKey: "id",
      partialItemSchema: {},
    },
    {
      fieldName: "searches",
      singularName: "search",
      itemSchema: {},
      matchKey: "id",
      partialItemSchema: {},
    },
  ],
  multilineFields: [],
  immutableFields: [],
  fuzzyFields: [],
}

describe("translateOps", () => {
  interface Case {
    name: string
    spec: TypedOpsSpec
    ops: Record<string, unknown>[]
    expected: JsonPatchOp[] | "error"
  }

  const cases: Case[] = [
    {
      name: "set: produces add ops per field (upsert)",
      spec: calloutSpec,
      ops: [{ op: "set", fields: { color: "red", title: "New" } }],
      expected: [
        { op: "add", path: "/color", value: "red" },
        { op: "add", path: "/title", value: "New" },
      ],
    },
    {
      name: "add_annotation: produces append op",
      spec: annotationsSpec,
      ops: [
        {
          op: "add_annotation",
          item: { text: "some text", reason: "important", code: "code_123" },
        },
      ],
      expected: [
        {
          op: "add",
          path: "/annotations/-",
          value: { text: "some text", reason: "important", code: "code_123" },
        },
      ],
    },
    {
      name: "remove_annotation: produces selector-based remove",
      spec: annotationsSpec,
      ops: [{ op: "remove_annotation", match: { id: "annotation_abc" } }],
      expected: [{ op: "remove", path: "/annotations[id=annotation_abc]" }],
    },
    {
      name: "set_annotation: produces selector-based replace per field",
      spec: annotationsSpec,
      ops: [
        {
          op: "set_annotation",
          match: { id: "annotation_abc" },
          fields: { code: "new_code", reason: "updated" },
        },
      ],
      expected: [
        { op: "replace", path: "/annotations[id=annotation_abc]/code", value: "new_code" },
        { op: "replace", path: "/annotations[id=annotation_abc]/reason", value: "updated" },
      ],
    },
    {
      name: "add_tag: produces append to tags array",
      spec: settingsSpec,
      ops: [{ op: "add_tag", item: { id: "tag_1", label: "new" } }],
      expected: [{ op: "add", path: "/tags/-", value: { id: "tag_1", label: "new" } }],
    },
    {
      name: "remove_search: produces selector-based remove on searches",
      spec: settingsSpec,
      ops: [{ op: "remove_search", match: { id: "search_abc" } }],
      expected: [{ op: "remove", path: "/searches[id=search_abc]" }],
    },
    {
      name: "set: null values produce remove ops",
      spec: calloutSpec,
      ops: [{ op: "set", fields: { color: "red", title: null } }],
      expected: [
        { op: "add", path: "/color", value: "red" },
        { op: "remove", path: "/title" },
      ],
    },
    {
      name: "multiple ops in sequence",
      spec: annotationsSpec,
      ops: [
        { op: "add_annotation", item: { text: "x", reason: "y" } },
        { op: "remove_annotation", match: { id: "annotation_old" } },
      ],
      expected: [
        { op: "add", path: "/annotations/-", value: { text: "x", reason: "y" } },
        { op: "remove", path: "/annotations[id=annotation_old]" },
      ],
    },
    {
      name: "unknown op throws",
      spec: calloutSpec,
      ops: [{ op: "nonexistent" }],
      expected: "error",
    },
  ]

  it.each(cases.filter((c) => c.expected !== "error"))("$name", ({ spec, ops, expected }) => {
    expect(translateOps(ops, spec)).toEqual(expected)
  })

  it("unknown op throws", () => {
    expect(() => translateOps([{ op: "nonexistent" }], calloutSpec)).toThrow("unknown op")
  })
})
