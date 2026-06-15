import { describe, it, expect } from "vitest"
import { summarizeEdits } from "./summarize"
import type { HistoryEntry } from "./types"

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  verb: "added",
  entityKind: "annotation",
  entityId: null,
  path: "doc.md",
  timestamp: 0,
  actor: "ai",
  label: "x",
  ...overrides,
})

describe("summarizeEdits", () => {
  const cases = [
    {
      name: "empty list is empty string",
      entries: [] as HistoryEntry[],
      expected: "",
    },
    {
      name: "single code uses verb phrase and entity label",
      entries: [entry({ entityKind: "code", verb: "added", label: "Theme of justice" })],
      expected: "Applied code: Theme of justice",
    },
    {
      name: "single file uses display name",
      entries: [entry({ entityKind: "file", verb: "created", path: "notes/a.md", label: "a.md" })],
      expected: "Created file: a.md",
    },
    {
      name: "uniform annotations in one file",
      entries: [entry(), entry(), entry()],
      expected: "Added 3 annotations in Doc",
    },
    {
      name: "uniform annotations across files",
      entries: [entry({ path: "a.md" }), entry({ path: "b.md" }), entry({ path: "c.md" })],
      expected: "Added 3 annotations across 3 files",
    },
    {
      name: "mixed kinds in one file",
      entries: [entry({ entityKind: "annotation" }), entry({ entityKind: "tag" })],
      expected: "2 changes in Doc",
    },
    {
      name: "mixed kinds across files",
      entries: [
        entry({ entityKind: "annotation", path: "a.md" }),
        entry({ entityKind: "code", path: "b.md" }),
      ],
      expected: "2 changes across 2 files",
    },
    {
      name: "same kind different verb is not uniform",
      entries: [entry({ verb: "added" }), entry({ verb: "removed" })],
      expected: "2 changes in Doc",
    },
  ]

  it.each(cases)("$name", ({ entries, expected }) => {
    expect(summarizeEdits(entries)).toBe(expected)
  })
})
