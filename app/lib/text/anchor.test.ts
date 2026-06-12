import { describe, it, expect } from "vitest"
import { resolveAnchor } from "./anchor"

const fixture = `# Doc

Het tekort loopt op tot 68 miljard euro in 2024.

We zullen werken aan herstel.

Het tekort kwam terug in het debat.
`

interface Case {
  name: string
  needle: string
  expected: { start: number; end: number } | { errorMatch: RegExp }
}

const cases: Case[] = [
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
    name: "ellipsis range resolves",
    needle: "Het tekort loopt op...in 2024.",
    expected: {
      start: fixture.indexOf("Het tekort loopt op"),
      end: fixture.indexOf("in 2024.") + "in 2024.".length,
    },
  },
  {
    name: "ellipsis empty anchor → error",
    needle: "...rest",
    expected: { errorMatch: /non-empty anchor/ },
  },
  {
    name: "ellipsis after-anchor missing",
    needle: "We zullen werken aan herstel...niet bestaande zin",
    expected: { errorMatch: /after .* not found/ },
  },
  {
    name: "more than one ellipsis → error",
    needle: "Het tekort...op tot...2024.",
    expected: { errorMatch: /only one/ },
  },
]

describe("resolveAnchor", () => {
  it.each(cases)("$name", ({ needle, expected }) => {
    const result = resolveAnchor(fixture, needle)
    if ("errorMatch" in expected) {
      expect(result).toMatchObject({ error: expect.any(String) })
      expect((result as { error: string }).error).toMatch(expected.errorMatch)
    } else {
      expect(result).toEqual(expected)
    }
  })
})
