import { describe, expect, it } from "vitest"
import { expandRangeRefs, type FileReader } from "./range-expand"
import type { FileStore } from "~/lib/files/store"
import { j } from "../test-helpers"

const NOTES = [
  "# Interview Notes",
  "",
  "## Participant Background",
  "",
  "Sarah is a senior nurse with 12 years of experience",
  "in the emergency department. She transitioned from",
  "a smaller regional hospital three years ago and has",
  "been vocal about staffing concerns since joining.",
  "",
  "## Key Observations",
  "",
  "The ward operates on rotating shifts with minimal",
  "handover time. Staff frequently skip breaks during",
  "peak hours. Morale appears low but collegial bonds",
  "are strong among long-serving team members.",
  "",
  "## Follow-up Questions",
  "",
  "Ask about the night shift incident from March.",
  "Clarify the timeline around the policy change.",
].join("\n")

const REPEATED = [
  "# Meeting Notes",
  "",
  "The team discussed the timeline.",
  "Everyone agreed it was tight.",
  "",
  "The client raised concerns about quality.",
  "The team discussed the timeline.",
  "A decision was made to extend.",
].join("\n")

const AMBIGUOUS_END = [
  "# Report",
  "",
  "## Introduction",
  "",
  "This section covers the findings.",
  "The results were significant.",
  "",
  "## Method",
  "",
  "The results were significant.",
  "Further analysis is needed.",
].join("\n")

interface Case {
  name: string
  patch: string
  files: FileStore
  currentPath: string
  expected?: string
  errorContains?: string
}

describe("expandRangeRefs", () => {
  const cases: Case[] = [
    {
      name: "expands add from another file",
      patch: j(
        "@@",
        " # Other File",
        "+<< notes.md",
        "+  ## Participant Background",
        "+  ...",
        "+  been vocal about staffing concerns since joining."
      ),
      files: { "notes.md": NOTES },
      currentPath: "other.md",
      expected: j(
        "@@",
        " # Other File",
        "+## Participant Background",
        "+",
        "+Sarah is a senior nurse with 12 years of experience",
        "+in the emergency department. She transitioned from",
        "+a smaller regional hospital three years ago and has",
        "+been vocal about staffing concerns since joining."
      ),
    },
    {
      name: "expands delete in current file",
      patch: j(
        "@@",
        "-<<",
        "-  ## Follow-up Questions",
        "-  ...",
        "-  Clarify the timeline around the policy change."
      ),
      files: { "notes.md": NOTES },
      currentPath: "notes.md",
      expected: j(
        "@@",
        "-## Follow-up Questions",
        "-",
        "-Ask about the night shift incident from March.",
        "-Clarify the timeline around the policy change."
      ),
    },
    {
      name: "bare << uses current path",
      patch: j(
        "@@",
        "+<<",
        "+  ## Key Observations",
        "+  ...",
        "+  are strong among long-serving team members."
      ),
      files: { "notes.md": NOTES },
      currentPath: "notes.md",
      expected: j(
        "@@",
        "+## Key Observations",
        "+",
        "+The ward operates on rotating shifts with minimal",
        "+handover time. Staff frequently skip breaks during",
        "+peak hours. Morale appears low but collegial bonds",
        "+are strong among long-serving team members."
      ),
    },
    {
      name: "passes through non-ref lines unchanged",
      patch: j("@@", " context", "+new line", "-old line"),
      files: {},
      currentPath: "any.md",
      expected: j("@@", " context", "+new line", "-old line"),
    },
    {
      name: "mixed ref and regular lines in same patch",
      patch: j(
        "@@",
        " context line",
        "+<< notes.md",
        "+  ## Key Observations",
        "+  ...",
        "+  are strong among long-serving team members.",
        "-old line"
      ),
      files: { "notes.md": NOTES },
      currentPath: "other.md",
      expected: j(
        "@@",
        " context line",
        "+## Key Observations",
        "+",
        "+The ward operates on rotating shifts with minimal",
        "+handover time. Staff frequently skip breaks during",
        "+peak hours. Morale appears low but collegial bonds",
        "+are strong among long-serving team members.",
        "-old line"
      ),
    },
    {
      name: "multi-line start anchor",
      patch: j(
        "@@",
        "+<< notes.md",
        "+  Sarah is a senior nurse with 12 years of experience",
        "+  in the emergency department. She transitioned from",
        "+  ...",
        "+  been vocal about staffing concerns since joining."
      ),
      files: { "notes.md": NOTES },
      currentPath: "other.md",
      expected: j(
        "@@",
        "+Sarah is a senior nurse with 12 years of experience",
        "+in the emergency department. She transitioned from",
        "+a smaller regional hospital three years ago and has",
        "+been vocal about staffing concerns since joining."
      ),
    },
    {
      name: "multi-line end anchor",
      patch: j(
        "@@",
        "+<< notes.md",
        "+  ## Participant Background",
        "+  ...",
        "+  a smaller regional hospital three years ago and has",
        "+  been vocal about staffing concerns since joining."
      ),
      files: { "notes.md": NOTES },
      currentPath: "other.md",
      expected: j(
        "@@",
        "+## Participant Background",
        "+",
        "+Sarah is a senior nurse with 12 years of experience",
        "+in the emergency department. She transitioned from",
        "+a smaller regional hospital three years ago and has",
        "+been vocal about staffing concerns since joining."
      ),
    },
    {
      name: "start anchor not found",
      patch: j("@@", "+<< notes.md", "+  ## Nonexistent Section", "+  ...", "+  some end anchor."),
      files: { "notes.md": NOTES },
      currentPath: "other.md",
      errorContains: "start anchor not found",
    },
    {
      name: "end anchor not found",
      patch: j(
        "@@",
        "+<< notes.md",
        "+  ## Participant Background",
        "+  ...",
        "+  this text does not exist anywhere in the file."
      ),
      files: { "notes.md": NOTES },
      currentPath: "other.md",
      errorContains: "end anchor not found",
    },
    {
      name: "start anchor ambiguous",
      patch: j(
        "@@",
        "+<< repeated.md",
        "+  The team discussed the timeline.",
        "+  ...",
        "+  A decision was made to extend."
      ),
      files: { "repeated.md": REPEATED },
      currentPath: "other.md",
      errorContains: "start anchor ambiguous",
    },
    {
      name: "end anchor ambiguous after unique start",
      patch: j(
        "@@",
        "+<< report.md",
        "+  ## Introduction",
        "+  ...",
        "+  The results were significant."
      ),
      files: { "report.md": AMBIGUOUS_END },
      currentPath: "other.md",
      errorContains: "end anchor ambiguous",
    },
    {
      name: "missing ... separator",
      patch: j(
        "@@",
        "+<< notes.md",
        "+  ## Participant Background",
        "+  been vocal about staffing concerns since joining."
      ),
      files: { "notes.md": NOTES },
      currentPath: "other.md",
      errorContains: "missing ... separator",
    },
    {
      name: "missing start anchor (... is first)",
      patch: j(
        "@@",
        "+<< notes.md",
        "+  ...",
        "+  been vocal about staffing concerns since joining."
      ),
      files: { "notes.md": NOTES },
      currentPath: "other.md",
      errorContains: "missing start anchor",
    },
    {
      name: "missing end anchor (... is last)",
      patch: j("@@", "+<< notes.md", "+  ## Participant Background", "+  ..."),
      files: { "notes.md": NOTES },
      currentPath: "other.md",
      errorContains: "missing end anchor",
    },
    {
      name: "file not found",
      patch: j("@@", "+<< nonexistent.md", "+  ## Start", "+  ...", "+  ## End"),
      files: {},
      currentPath: "other.md",
      errorContains: "file not found: nonexistent.md",
    },
  ]

  const run = (c: Case) => {
    const readFile: FileReader = (path) => c.files[path]
    return expandRangeRefs(c.patch, readFile, c.currentPath)
  }

  it.each(cases)("$name", (c) => {
    const result = run(c)
    if (c.expected !== undefined) {
      expect(result).toEqual({ ok: true, patch: c.expected })
    } else {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain(c.errorContains)
    }
  })
})
