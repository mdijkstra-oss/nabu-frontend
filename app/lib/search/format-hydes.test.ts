import { describe, it, expect } from "vitest"
import { formatHydeDebug } from "./format-hydes"
import type { HydeQuery } from "./semantic"

const hyde = (language: string, text: string): HydeQuery => ({
  text,
  type: "direct",
  language,
  cosineVector: [],
})

describe("formatHydeDebug", () => {
  const cases: { name: string; hydes: HydeQuery[]; expected: string }[] = [
    {
      name: "empty input",
      hydes: [],
      expected: "",
    },
    {
      name: "single language single text",
      hydes: [hyde("eng", "I feel anxious")],
      expected: "━━━ ENG ━━━\n  1. I feel anxious",
    },
    {
      name: "single language multiple texts",
      hydes: [hyde("eng", "I feel anxious"), hyde("eng", "Workplace stress is rising")],
      expected: "━━━ ENG ━━━\n  1. I feel anxious\n  2. Workplace stress is rising",
    },
    {
      name: "multiple languages",
      hydes: [
        hyde("eng", "I feel anxious"),
        hyde("eng", "Workplace stress is rising"),
        hyde("nld", "Ik voel me angstig"),
      ],
      expected:
        "━━━ ENG ━━━\n  1. I feel anxious\n  2. Workplace stress is rising\n\n━━━ NLD ━━━\n  1. Ik voel me angstig",
    },
    {
      name: "preserves insertion order across languages",
      hydes: [
        hyde("nld", "rapport tekst"),
        hyde("eng", "interview text"),
        hyde("nld", "interview tekst"),
      ],
      expected:
        "━━━ NLD ━━━\n  1. rapport tekst\n  2. interview tekst\n\n━━━ ENG ━━━\n  1. interview text",
    },
  ]

  it.each(cases)("$name", ({ hydes, expected }) => {
    expect(formatHydeDebug(hydes)).toBe(expected)
  })
})
