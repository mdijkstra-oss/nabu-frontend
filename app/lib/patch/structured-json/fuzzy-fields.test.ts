import { describe, it, expect } from "vitest"
import type { JsonPatchOp } from "./apply"
import { parseFuzzyFieldPatterns, resolveFuzzyFieldValues } from "./fuzzy-fields"

const annotationPatterns = parseFuzzyFieldPatterns(["annotations.*.text"])

describe("resolveFuzzyFieldValues", () => {
  interface Case {
    name: string
    content: string
    op: JsonPatchOp
    expected: { ok: true; op: JsonPatchOp } | { ok: false; error: string }
  }

  const prose = "The **organizational** culture was particularly supportive of new staff."

  const cases: Case[] = [
    {
      name: "resolves text in annotation entry add",
      content: prose,
      op: {
        op: "add",
        path: "/annotations/-",
        value: { text: "organizational culture was particularly supportive", code: "x" },
      },
      expected: {
        ok: true,
        op: {
          op: "add",
          path: "/annotations/-",
          value: { text: "organizational culture was particularly supportive", code: "x" },
        },
      },
    },
    {
      name: "strips markdown decoration from canonical span",
      content: "The **organizational** culture was supportive.",
      op: {
        op: "replace",
        path: "/annotations/0",
        value: { text: "the organizational culture was supportive" },
      },
      expected: {
        ok: true,
        op: {
          op: "replace",
          path: "/annotations/0",
          value: { text: "The organizational culture was supportive." },
        },
      },
    },
    {
      name: "resolves direct text field",
      content: prose,
      op: {
        op: "replace",
        path: "/annotations/2/text",
        value: "organizational culture was particularly supportive",
      },
      expected: {
        ok: true,
        op: {
          op: "replace",
          path: "/annotations/2/text",
          value: "organizational culture was particularly supportive",
        },
      },
    },
    {
      name: "errors when text not in prose",
      content: prose,
      op: {
        op: "add",
        path: "/annotations/-",
        value: { text: "completely unrelated phrase that does not appear" },
      },
      expected: { ok: false, error: "/annotations/-: Text not found in document" },
    },
    {
      name: "passes non-annotation path through unchanged",
      content: prose,
      op: { op: "add", path: "/codes/-", value: { text: "anything goes here" } },
      expected: {
        ok: true,
        op: { op: "add", path: "/codes/-", value: { text: "anything goes here" } },
      },
    },
    {
      name: "passes remove op through unchanged",
      content: prose,
      op: { op: "remove", path: "/annotations/0" },
      expected: { ok: true, op: { op: "remove", path: "/annotations/0" } },
    },
    {
      name: "passes test op through unchanged",
      content: prose,
      op: { op: "test", path: "/annotations/0/text", value: "anything" },
      expected: { ok: true, op: { op: "test", path: "/annotations/0/text", value: "anything" } },
    },
    {
      name: "passes annotation entry without text field through unchanged",
      content: prose,
      op: { op: "add", path: "/annotations/-", value: { code: "x" } },
      expected: { ok: true, op: { op: "add", path: "/annotations/-", value: { code: "x" } } },
    },
    {
      name: "passes non-string annotation text field through unchanged",
      content: prose,
      op: { op: "replace", path: "/annotations/0/text", value: 42 },
      expected: { ok: true, op: { op: "replace", path: "/annotations/0/text", value: 42 } },
    },
  ]

  it.each(cases)("$name", ({ content, op, expected }) => {
    const result = resolveFuzzyFieldValues([op], content, annotationPatterns)
    if (expected.ok) {
      expect(result).toEqual({ ok: true, ops: [expected.op] })
    } else {
      expect(result).toEqual({ ok: false, error: expected.error })
    }
  })

  it("resolves multiple ops in order", () => {
    const ops: JsonPatchOp[] = [
      { op: "add", path: "/annotations/-", value: { text: "organizational culture" } },
      { op: "add", path: "/annotations/-", value: { text: "particularly supportive" } },
    ]
    const result = resolveFuzzyFieldValues(ops, prose, annotationPatterns)
    expect(result).toEqual({
      ok: true,
      ops: [
        { op: "add", path: "/annotations/-", value: { text: "organizational culture" } },
        { op: "add", path: "/annotations/-", value: { text: "particularly supportive" } },
      ],
    })
  })
})
