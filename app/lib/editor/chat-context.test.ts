import { describe, expect, it, beforeEach } from "vitest"
import {
  setPageContext,
  setPageContextOverride,
  getPageContext,
  findLastContextMessage,
  CONTEXT_PREFIX,
} from "./chat-context"
import type { Block } from "~/lib/agent/client/blocks"

const resetSlots = () => {
  setPageContext(undefined)
  setPageContextOverride(undefined)
}

describe("getPageContext", () => {
  beforeEach(resetSlots)

  const cases = [
    {
      name: "returns base when only base is set",
      base: () => "base context",
      override: undefined as (() => string | null) | undefined,
      expected: "base context",
    },
    {
      name: "returns override when both are set",
      base: () => "base context",
      override: () => "override context",
      expected: "override context",
    },
    {
      name: "falls back to base when override returns null",
      base: () => "base context",
      override: () => null,
      expected: "base context",
    },
    {
      name: "returns null when neither is set",
      base: undefined as (() => string | null) | undefined,
      override: undefined as (() => string | null) | undefined,
      expected: null,
    },
    {
      name: "returns override when only override is set",
      base: undefined as (() => string | null) | undefined,
      override: () => "override only",
      expected: "override only",
    },
    {
      name: "returns null when base returns null and no override",
      base: () => null,
      override: undefined as (() => string | null) | undefined,
      expected: null,
    },
  ]

  it.each(cases)("$name", ({ base, override, expected }) => {
    setPageContext(base)
    setPageContextOverride(override)
    expect(getPageContext()).toBe(expected)
  })

  it("falls back to base after override is cleared", () => {
    setPageContext(() => "base")
    setPageContextOverride(() => "override")
    expect(getPageContext()).toBe("override")

    setPageContextOverride(undefined)
    expect(getPageContext()).toBe("base")
  })
})

describe("findLastContextMessage", () => {
  const cases = [
    {
      name: "finds last context block",
      history: [
        { type: "system", content: `${CONTEXT_PREFIX}\nDoc A` },
        { type: "user", content: "hello" },
        { type: "system", content: `${CONTEXT_PREFIX}\nDoc B` },
        { type: "user", content: "world" },
      ] as Block[],
      expected: `${CONTEXT_PREFIX}\nDoc B`,
    },
    {
      name: "returns null when no context blocks exist",
      history: [
        { type: "user", content: "hello" },
        { type: "assistant", content: "hi" },
      ] as Block[],
      expected: null,
    },
    {
      name: "returns null for empty history",
      history: [] as Block[],
      expected: null,
    },
    {
      name: "ignores system blocks without context prefix",
      history: [
        { type: "system", content: "some other system message" },
        { type: "user", content: "hello" },
      ] as Block[],
      expected: null,
    },
  ]

  it.each(cases)("$name", ({ history, expected }) => {
    expect(findLastContextMessage(history)).toBe(expected)
  })
})
