import { describe, test, expect } from "vitest"
import { linkifyEntityIds } from "./entities"

const resolve = (id: string): string | null => {
  const names: Record<string, string> = {
    "annotation-1a2b3c4d": "user frustration",
    "callout-7xk2m9p1": "User Frustration",
    "callout-4a1b2c3d": "Theme A",
    "interview-notes.md": "interview-notes",
    "P01.md": "P01",
  }
  return names[id] ?? null
}

const formatMissing = (id: string): string | null =>
  id.endsWith(".md") ? `**${id.replace(/\.md$/, "").replace(/_/g, " ")}**` : null

type FormatMissing = (id: string) => string | null
interface Case {
  name: string
  input: string
  expected: string
  formatMissing?: FormatMissing
}

describe("linkifyEntityIds", () => {
  const cases: Case[] = [
    {
      name: "links bare annotation ID",
      input: "See annotation-1a2b3c4d for details",
      expected: "See [user frustration](file://annotation-1a2b3c4d) for details",
    },
    {
      name: "links bare callout ID",
      input: "Applied callout-7xk2m9p1 three times",
      expected: "Applied [User Frustration](file://callout-7xk2m9p1) three times",
    },
    {
      name: "skips ID inside existing markdown link",
      input: "[User Frustration](file://callout-7xk2m9p1)",
      expected: "[User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "strips backtick wrapping around ID",
      input: "See `callout-7xk2m9p1` here",
      expected: "See [User Frustration](file://callout-7xk2m9p1) here",
    },
    {
      name: "strips paren wrapping around ID",
      input: "See (callout-7xk2m9p1) here",
      expected: "See [User Frustration](file://callout-7xk2m9p1) here",
    },
    {
      name: "links multiple IDs in one string",
      input: "Compare annotation-1a2b3c4d and callout-7xk2m9p1",
      expected:
        "Compare [user frustration](file://annotation-1a2b3c4d) and [User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "leaves unresolvable ID bare",
      input: "Unknown callout-9z9z9z9z here",
      expected: "Unknown callout-9z9z9z9z here",
    },
    {
      name: "links ID adjacent to punctuation",
      input: "Found callout-7xk2m9p1.",
      expected: "Found [User Frustration](file://callout-7xk2m9p1).",
    },
    {
      name: "links ID at end of sentence with comma",
      input: "Codes: callout-7xk2m9p1, callout-4a1b2c3d",
      expected:
        "Codes: [User Frustration](file://callout-7xk2m9p1), [Theme A](file://callout-4a1b2c3d)",
    },
    {
      name: "strips name after ID with em dash",
      input: "- callout-7xk2m9p1 — User Frustration",
      expected: "- [User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "strips name after ID with hyphen",
      input: "callout-7xk2m9p1 - User Frustration",
      expected: "[User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "strips name after ID with colon",
      input: "callout-7xk2m9p1: User Frustration",
      expected: "[User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "strips name before ID with em dash",
      input: "User Frustration — callout-7xk2m9p1",
      expected: "[User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "strips name before ID in parens",
      input: "User Frustration (callout-7xk2m9p1)",
      expected: "[User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "strips name after ID in parens",
      input: "callout-7xk2m9p1 (User Frustration)",
      expected: "[User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "strips bold-decorated name before ID",
      input: "the move as **User Frustration** (callout-7xk2m9p1)",
      expected: "the move as [User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "strips bold-decorated name after ID",
      input: "callout-7xk2m9p1 — **User Frustration**",
      expected: "[User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "strips italic-decorated name before ID",
      input: "coded as *User Frustration* (callout-7xk2m9p1)",
      expected: "coded as [User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "does not strip partial name match",
      input: "callout-7xk2m9p1 — User Frustrations",
      expected: "[User Frustration](file://callout-7xk2m9p1) — User Frustrations",
    },
    {
      name: "strips names in bullet list",
      input: "- callout-7xk2m9p1 — User Frustration\n- callout-4a1b2c3d — Theme A",
      expected:
        "- [User Frustration](file://callout-7xk2m9p1)\n- [Theme A](file://callout-4a1b2c3d)",
    },
    {
      name: "links bare document filename",
      input: "See interview-notes.md for context",
      expected: "See [interview-notes](file://interview-notes.md) for context",
    },
    {
      name: "skips document filename inside existing link",
      input: "[Interview Notes](file://interview-notes.md)",
      expected: "[Interview Notes](file://interview-notes.md)",
    },
    {
      name: "leaves unknown document filename bare without formatMissing",
      input: "Check unknown-file.md here",
      expected: "Check unknown-file.md here",
    },
    {
      name: "links mixed entity types and documents",
      input: "Found callout-7xk2m9p1 in P01.md",
      expected: "Found [User Frustration](file://callout-7xk2m9p1) in [P01](file://P01.md)",
    },
    {
      name: "strips name connected by word glue like 'is'",
      input: "User Frustration is callout-7xk2m9p1",
      expected: "[User Frustration](file://callout-7xk2m9p1)",
    },
    {
      name: "returns unchanged text with no IDs",
      input: "No entities here at all",
      expected: "No entities here at all",
    },
    {
      name: "returns empty string unchanged",
      input: "",
      expected: "",
    },
    {
      name: "links double-quoted ID consuming quotes",
      input: 'key is "callout-7xk2m9p1" here',
      expected: "key is [User Frustration](file://callout-7xk2m9p1) here",
    },
    {
      name: "links single-quoted ID consuming quotes",
      input: "key is 'callout-7xk2m9p1' here",
      expected: "key is [User Frustration](file://callout-7xk2m9p1) here",
    },
    {
      name: "links double-quoted annotation ID consuming quotes",
      input: 'flagged "annotation-1a2b3c4d" for review',
      expected: "flagged [user frustration](file://annotation-1a2b3c4d) for review",
    },
    {
      name: "links ID inside longer quoted prose",
      input: '"See callout-7xk2m9p1 for details"',
      expected: '"See [User Frustration](file://callout-7xk2m9p1) for details"',
    },
    {
      name: "links ID with file:// prefix",
      input: "href is file://callout-7xk2m9p1 here",
      expected: "href is [User Frustration](file://callout-7xk2m9p1) here",
    },
    {
      name: "links file:// prefixed .md filename",
      input: "see file://interview-notes.md for context",
      expected: "see [interview-notes](file://interview-notes.md) for context",
    },
    {
      name: "links double-quoted ID with wrapper parens consuming all",
      input: '"(callout-7xk2m9p1)" used as key',
      expected: "[User Frustration](file://callout-7xk2m9p1) used as key",
    },
    {
      name: "links double-quoted .md filename consuming quotes",
      input: 'transcript: "interview-notes.md".',
      expected: "transcript: [interview-notes](file://interview-notes.md).",
    },
    {
      name: "links single-quoted .md filename consuming quotes",
      input: "transcript: 'interview-notes.md'.",
      expected: "transcript: [interview-notes](file://interview-notes.md).",
    },
    {
      name: "formats unknown .md file with formatMissing",
      input: "Check unknown-file.md here",
      expected: "Check **unknown-file** here",
      formatMissing,
    },
    {
      name: "consumes quotes around unknown .md file",
      input: 'removed "codebook_general.md" today',
      expected: "removed **codebook general** today",
      formatMissing,
    },
    {
      name: "ignores unknown non-file entity with formatMissing",
      input: "Unknown callout-9z9z9z9z here",
      expected: "Unknown callout-9z9z9z9z here",
      formatMissing,
    },
    {
      name: "still resolves known files normally with formatMissing",
      input: "See interview-notes.md for context",
      expected: "See [interview-notes](file://interview-notes.md) for context",
      formatMissing,
    },
    {
      name: "skips unknown .md inside file:// URL with formatMissing",
      input: "href is file://unknown-file.md here",
      expected: "href is file://unknown-file.md here",
      formatMissing,
    },
    {
      name: "links entity ID with capitalized prefix",
      input: "See Annotation-1a2b3c4d for details",
      expected: "See [user frustration](file://annotation-1a2b3c4d) for details",
    },
    {
      name: "links entity ID with uppercase prefix",
      input: "Applied CALLOUT-7xk2m9p1 here",
      expected: "Applied [User Frustration](file://callout-7xk2m9p1) here",
    },
    {
      name: "strips name from capitalized prefix ID",
      input: "Callout-7xk2m9p1 — User Frustration",
      expected: "[User Frustration](file://callout-7xk2m9p1)",
    },
  ]

  test.each(cases)("$name", ({ input, expected, formatMissing }) => {
    expect(linkifyEntityIds(input, resolve, formatMissing)).toBe(expected)
  })
})
