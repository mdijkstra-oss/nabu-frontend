import { describe, it, expect } from "vitest"
import { formatNumberedPassage } from "./format"

describe("formatNumberedPassage", () => {
  const cases: {
    name: string
    text: string
    opts?: { prefix?: string; offset?: number; separator?: string }
    expected: string
  }[] = [
    {
      name: "numbers from 1 inline",
      text: "Alpha. Beta. Gamma.",
      expected: "[1] Alpha. [2] Beta. [3] Gamma.",
    },
    {
      name: "single sentence",
      text: "Only one.",
      expected: "[1] Only one.",
    },
    {
      name: "empty text",
      text: "",
      expected: "",
    },
    {
      name: "preserves paragraph break",
      text: "First. Second.\n\nThird. Fourth.",
      expected: "[1] First. [2] Second.\n\n[3] Third. [4] Fourth.",
    },
    {
      name: "multiple blank lines collapse to one paragraph break",
      text: "A.\n\n\nB.",
      expected: "[1] A.\n\n[2] B.",
    },
    {
      name: "prefix option",
      text: "Alpha. Beta.",
      opts: { prefix: "a" },
      expected: "[a1] Alpha. [a2] Beta.",
    },
    {
      name: "offset option",
      text: "Alpha. Beta.",
      opts: { offset: 5 },
      expected: "[6] Alpha. [7] Beta.",
    },
    {
      name: "prefix and offset together",
      text: "Alpha. Beta.",
      opts: { prefix: "b", offset: 3 },
      expected: "[b4] Alpha. [b5] Beta.",
    },
    {
      name: "dashed separator with prefix",
      text: "Alpha. Beta.",
      opts: { prefix: "a", separator: "-" },
      expected: "[a-1] Alpha. [a-2] Beta.",
    },
    {
      name: "dashed separator with prefix and offset",
      text: "Alpha. Beta.",
      opts: { prefix: "b", separator: "-", offset: 4 },
      expected: "[b-5] Alpha. [b-6] Beta.",
    },
    {
      name: "separator ignored when no prefix",
      text: "Alpha. Beta.",
      opts: { separator: "-" },
      expected: "[1] Alpha. [2] Beta.",
    },
  ]

  it.each(cases)("$name", ({ text, opts, expected }) => {
    expect(formatNumberedPassage(text, opts)).toBe(expected)
  })
})
