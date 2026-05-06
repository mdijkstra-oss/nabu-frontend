import { describe, expect, it } from "vitest"
import { collectApproachKeys, evaluateGuidance, type GuidanceCheck } from "./guidance"
import { toMarkerBlock } from "../client/markers"
import type { Block } from "../client/blocks"
import { systemBlock, textBlock, userBlock } from "../test-helpers"

const compactedResult = (): Block => ({
  type: "tool_result",
  callId: "c0",
  toolName: "compacted",
  result: { status: "ok", output: "ok" },
})

describe("collectApproachKeys", () => {
  const cases = [
    {
      name: "empty history → empty set",
      blocks: [],
      expected: new Set<string>(),
    },
    {
      name: "no markers → empty set",
      blocks: [userBlock("hi"), textBlock("hello")],
      expected: new Set<string>(),
    },
    {
      name: "single marker → set with one key",
      blocks: [toMarkerBlock("qual-coding/project/output")],
      expected: new Set(["qual-coding/project/output"]),
    },
    {
      name: "multiple markers → set with all keys",
      blocks: [
        toMarkerBlock("qual-coding/project/output"),
        userBlock("hi"),
        toMarkerBlock("qual-coding/codebook/review"),
      ],
      expected: new Set(["qual-coding/project/output", "qual-coding/codebook/review"]),
    },
    {
      name: "ignores other system blocks",
      blocks: [
        systemBlock("<!-- prompt: planning -->"),
        toMarkerBlock("qual-coding/project/output"),
      ],
      expected: new Set(["qual-coding/project/output"]),
    },
    {
      name: "markers before compaction are ignored",
      blocks: [
        toMarkerBlock("qual-coding/project/output"),
        compactedResult(),
        userBlock("continuing"),
      ],
      expected: new Set<string>(),
    },
    {
      name: "markers after compaction are kept",
      blocks: [
        toMarkerBlock("qual-coding/codebook/review"),
        compactedResult(),
        toMarkerBlock("qual-coding/project/output"),
      ],
      expected: new Set(["qual-coding/project/output"]),
    },
    {
      name: "last compaction is the floor",
      blocks: [
        toMarkerBlock("a"),
        compactedResult(),
        toMarkerBlock("b"),
        compactedResult(),
        toMarkerBlock("c"),
      ],
      expected: new Set(["c"]),
    },
  ]

  it.each(cases)("$name", ({ blocks, expected }) => {
    expect(collectApproachKeys(blocks)).toEqual(expected)
  })
})

describe("evaluateGuidance", () => {
  const known = new Set(["qual-coding/project/output", "qual-coding/codebook/review"])

  const cases: { name: string; check: GuidanceCheck; toErrorIsNull: boolean; toPush: string[] }[] =
    [
      {
        name: "all required known and present → no error, no push",
        check: {
          required: ["qual-coding/project/output"],
          knownKeys: known,
          presentKeys: new Set(["qual-coding/project/output"]),
        },
        toErrorIsNull: true,
        toPush: [],
      },
      {
        name: "all required unknown → no error, no push (silent drop)",
        check: {
          required: ["does/not/exist"],
          knownKeys: known,
          presentKeys: new Set(),
        },
        toErrorIsNull: true,
        toPush: [],
      },
      {
        name: "known but missing → error and push",
        check: {
          required: ["qual-coding/project/output"],
          knownKeys: known,
          presentKeys: new Set(),
        },
        toErrorIsNull: false,
        toPush: ["qual-coding/project/output"],
      },
      {
        name: "mixed known/unknown, missing → push only the known missing",
        check: {
          required: ["qual-coding/project/output", "does/not/exist"],
          knownKeys: known,
          presentKeys: new Set(),
        },
        toErrorIsNull: false,
        toPush: ["qual-coding/project/output"],
      },
      {
        name: "two known, one present → push only the missing",
        check: {
          required: ["qual-coding/project/output", "qual-coding/codebook/review"],
          knownKeys: known,
          presentKeys: new Set(["qual-coding/codebook/review"]),
        },
        toErrorIsNull: false,
        toPush: ["qual-coding/project/output"],
      },
    ]

  it.each(cases)("$name", ({ check, toErrorIsNull, toPush }) => {
    const decision = evaluateGuidance(check)
    expect(decision.toError === null).toBe(toErrorIsNull)
    expect(decision.toPush).toEqual(toPush)
  })
})
