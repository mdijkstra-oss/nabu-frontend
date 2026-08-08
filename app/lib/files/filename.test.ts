import { describe, it, expect } from "vitest"
import {
  normalizeFilename,
  toDisplayName,
  boldMissingFile,
  isProtectedFile,
  isHiddenFile,
  nextUntitledFilename,
  nextAvailableFilename,
  displayNameToFilename,
  renameTargetFor,
  PREFERENCES_FILE,
  SETTINGS_FILE,
} from "./filename"

describe("normalizeFilename", () => {
  const cases = [
    { input: "My File.md", expected: "my_file.md" },
    { input: "PREFERENCES.md", expected: "preferences.md" },
    { input: "already_normal.md", expected: "already_normal.md" },
    { input: "Mixed Case With Spaces.md", expected: "mixed_case_with_spaces.md" },
    { input: "  extra  spaces  .md", expected: "__extra__spaces__.md" },
    { input: "Interview Håkon.md", expected: "interview_hakon.md" },
    { input: "Café Señor Ünal.md", expected: "cafe_senor_unal.md" },
    { input: "Straße Æon Øst.md", expected: "strasse_aeon_ost.md" },
    { input: "Q&A session.md", expected: "q_a_session.md" },
    { input: "Notes #3 (final).md", expected: "notes__3_(final).md" },
    { input: "interview: part 1.md", expected: "interview__part_1.md" },
    { input: "research/notes.md", expected: "research_notes.md" },
    { input: ".scratch.md", expected: "scratch.md" },
    { input: "draft..md", expected: "draft.md" },
    { input: "../../etc/passwd", expected: "etc_passwd" },
    { input: "###", expected: "___" },
    { input: "...", expected: "untitled.md" },
    { input: "", expected: "untitled.md" },
  ]
  it.each(cases)('"$input" → "$expected"', ({ input, expected }) => {
    expect(normalizeFilename(input)).toBe(expected)
  })

  it("is idempotent", () => {
    for (const { expected } of cases) {
      expect(normalizeFilename(expected)).toBe(expected)
    }
  })

  // The server's own rule, restated. A name this produces that it rejects is a file
  // the user loses.
  it("only produces names the server stores", () => {
    const storable = /^[a-z0-9\-_.(),']+$/
    const inputs = [...cases.map((c) => c.input), "Ünïcødé ☃ 名前.md", "a".repeat(200) + ".md"]
    for (const input of inputs) {
      const name = normalizeFilename(input)
      expect(name).toMatch(storable)
      expect(name.startsWith(".")).toBe(false)
      expect(name).not.toContain("..")
    }
  })
})

describe("toDisplayName", () => {
  const cases = [
    { input: "preferences.md", expected: "Preferences" },
    { input: "my_interview_notes.md", expected: "My Interview Notes" },
    { input: "already.md", expected: "Already" },
    { input: "no_extension", expected: "No Extension" },
    { input: "multi_word_file_name.md", expected: "Multi Word File Name" },
    { input: "settings.hidden.md", expected: "Settings" },
    { input: "debug.hidden.md", expected: "Debug" },
  ]
  it.each(cases)('"$input" → "$expected"', ({ input, expected }) => {
    expect(toDisplayName(input)).toBe(expected)
  })
})

describe("boldMissingFile", () => {
  const cases = [
    { input: "codebook_general.md", expected: "**Codebook General**" },
    { input: "interview-notes.md", expected: "**Interview-Notes**" },
    { input: "annotation-1a2b3c4d", expected: null },
    { input: "callout-7xk2m9p1", expected: null },
    { input: "not_a_file", expected: null },
  ]
  it.each(cases)('"$input" → $expected', ({ input, expected }) => {
    expect(boldMissingFile(input)).toBe(expected)
  })
})

describe("isProtectedFile", () => {
  const cases = [
    { input: PREFERENCES_FILE, expected: true },
    { input: SETTINGS_FILE, expected: true },
    { input: "some_doc.md", expected: false },
    { input: "debug.hidden.md", expected: false },
  ]
  it.each(cases)('"$input" → $expected', ({ input, expected }) => {
    expect(isProtectedFile(input)).toBe(expected)
  })
})

describe("nextUntitledFilename", () => {
  const cases = [
    { existing: [], expected: "untitled.md" },
    { existing: ["notes.md"], expected: "untitled.md" },
    { existing: ["untitled.md"], expected: "untitled-2.md" },
    { existing: ["untitled.md", "untitled-2.md"], expected: "untitled-3.md" },
    // A gap is filled rather than counting past the highest taken number.
    { existing: ["untitled.md", "untitled-3.md"], expected: "untitled-2.md" },
    { existing: ["untitled-2.md"], expected: "untitled.md" },
    { existing: ["UNTITLED.md"], expected: "untitled.md" },
  ]
  it.each(cases)("$existing → $expected", ({ existing, expected }) => {
    expect(nextUntitledFilename(existing)).toBe(expected)
  })
})

describe("nextAvailableFilename", () => {
  const cases = [
    { desired: "notes.md", existing: [], expected: "notes.md" },
    { desired: "notes.md", existing: ["other.md"], expected: "notes.md" },
    { desired: "notes.md", existing: ["notes.md"], expected: "notes-2.md" },
    { desired: "notes.md", existing: ["notes.md", "notes-2.md"], expected: "notes-3.md" },
    { desired: "notes.md", existing: ["notes-2.md"], expected: "notes.md" },
    // A gap is filled rather than counting past the highest taken number.
    { desired: "notes.md", existing: ["notes.md", "notes-3.md"], expected: "notes-2.md" },
  ]
  it.each(cases)('"$desired" among $existing → "$expected"', ({ desired, existing, expected }) => {
    expect(nextAvailableFilename(desired, existing)).toBe(expected)
  })
})

describe("displayNameToFilename", () => {
  const cases = [
    { input: "My Document", expected: "my_document.md" },
    { input: "Preferences", expected: "preferences.md" },
    { input: "  padded  ", expected: "padded.md" },
    { input: "Repeated   Spaces", expected: "repeated_spaces.md" },
    { input: "Hyphen-ated", expected: "hyphen-ated.md" },
    { input: "Café Señor", expected: "cafe_senor.md" },
    { input: "Straße Øst", expected: "strasse_ost.md" },
    { input: "v1.2 Notes", expected: "v1.2_notes.md" },
    { input: "Q&A: Session #3", expected: "q_a__session__3.md" },
    { input: "Notes.md", expected: "notes.md" },
    { input: "Trailing...", expected: "trailing.md" },
    { input: "名前", expected: "__.md" },
    { input: "", expected: "untitled.md" },
    { input: "   ", expected: "untitled.md" },
    { input: ".md", expected: "untitled.md" },
  ]
  it.each(cases)('"$input" → "$expected"', ({ input, expected }) => {
    expect(displayNameToFilename(input)).toBe(expected)
  })

  // The header re-derives its title from the committed filename; for plain titles
  // the user must see exactly what they typed.
  it("round-trips plain titles through toDisplayName", () => {
    for (const title of ["My Document", "Meeting Notes", "Preferences"]) {
      expect(toDisplayName(displayNameToFilename(title))).toBe(title)
    }
  })
})

describe("renameTargetFor", () => {
  const cases = [
    {
      name: "renames to the typed title",
      current: "notes.md",
      display: "Meeting Notes",
      existing: ["notes.md"],
      expected: "meeting_notes.md",
    },
    {
      name: "no-op when the title already names this file",
      current: "notes.md",
      display: "Notes",
      existing: ["notes.md"],
      expected: null,
    },
    {
      name: "no-op on a case-only edit",
      current: "my_doc.md",
      display: "MY DOC",
      existing: ["my_doc.md"],
      expected: null,
    },
    {
      name: "suffixes when the name is taken by another file",
      current: "notes.md",
      display: "Draft",
      existing: ["notes.md", "draft.md"],
      expected: "draft-2.md",
    },
    {
      name: "no-op when the free suffix is the current name",
      current: "notes-2.md",
      display: "Notes",
      existing: ["notes.md", "notes-2.md"],
      expected: null,
    },
  ]
  it.each(cases)("$name", ({ current, display, existing, expected }) => {
    expect(renameTargetFor(current, display, existing)).toBe(expected)
  })
})

describe("isHiddenFile", () => {
  const cases = [
    { input: "settings.hidden.md", expected: true },
    { input: "debug.hidden.md", expected: true },
    { input: "preferences.md", expected: false },
    { input: "my_doc.md", expected: false },
  ]
  it.each(cases)('"$input" → $expected', ({ input, expected }) => {
    expect(isHiddenFile(input)).toBe(expected)
  })
})
