import { describe, it, expect } from "vitest"
import { resolveAnchor, resolveAnchorRange } from "./anchor"

const fixture = `# Doc

Het tekort loopt op tot 68 miljard euro in 2024.

We zullen werken aan herstel.

Het tekort kwam terug in het debat.
`

interface AnchorCase {
  name: string
  needle: string
  expected: { start: number; end: number } | { errorMatch: RegExp }
}

const anchorCases: AnchorCase[] = [
  {
    name: "exact unique substring",
    needle: "We zullen werken aan herstel.",
    expected: {
      start: fixture.indexOf("We zullen werken aan herstel."),
      end:
        fixture.indexOf("We zullen werken aan herstel.") + "We zullen werken aan herstel.".length,
    },
  },
  {
    name: "exact substring with multiple occurrences → ambiguous",
    needle: "Het tekort",
    expected: { errorMatch: /matches 2 locations/ },
  },
  {
    name: "token-strict fallback (punctuation differs)",
    needle: "het tekort loopt op",
    expected: {
      start: fixture.indexOf("Het tekort loopt op"),
      end: fixture.indexOf("Het tekort loopt op") + "Het tekort loopt op".length,
    },
  },
  {
    name: "needle not present",
    needle: "totally unrelated phrase",
    expected: { errorMatch: /not found/ },
  },
  {
    name: "curly vs straight apostrophe matches",
    needle: "the GGD’s in Rotterdam",
    expected: { errorMatch: /not found/ },
  },
]

describe("resolveAnchor", () => {
  it.each(anchorCases)("$name", ({ needle, expected }) => {
    const result = resolveAnchor(fixture, needle)
    if ("errorMatch" in expected) {
      expect(result).toMatchObject({ error: expect.any(String) })
      expect((result as { error: string }).error).toMatch(expected.errorMatch)
    } else {
      expect(result).toEqual(expected)
    }
  })
})

interface RangeCase {
  name: string
  anchorStart: string
  anchorEnd: string
  expected: { start: number; end: number } | { errorMatch: RegExp }
}

const rangeCases: RangeCase[] = [
  {
    name: "range from start anchor to end anchor",
    anchorStart: "Het tekort loopt op",
    anchorEnd: "in 2024.",
    expected: {
      start: fixture.indexOf("Het tekort loopt op"),
      end: fixture.indexOf("in 2024.") + "in 2024.".length,
    },
  },
  {
    name: "anchor_start ambiguous → error",
    anchorStart: "Het tekort",
    anchorEnd: "in 2024.",
    expected: { errorMatch: /anchor_start matches 2 locations/ },
  },
  {
    name: "anchor_end missing after anchor_start → error",
    anchorStart: "We zullen werken aan herstel.",
    anchorEnd: "niet bestaande zin",
    expected: { errorMatch: /anchor_end not found/ },
  },
  {
    name: "empty anchor → error",
    anchorStart: "",
    anchorEnd: "in 2024.",
    expected: { errorMatch: /must each be non-empty/ },
  },
]

describe("resolveAnchorRange", () => {
  it.each(rangeCases)("$name", ({ anchorStart, anchorEnd, expected }) => {
    const result = resolveAnchorRange(fixture, anchorStart, anchorEnd)
    if ("errorMatch" in expected) {
      expect(result).toMatchObject({ error: expect.any(String) })
      expect((result as { error: string }).error).toMatch(expected.errorMatch)
    } else {
      expect(result).toEqual(expected)
    }
  })
})
