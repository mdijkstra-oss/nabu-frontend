import { describe, it, expect } from "vitest"
import {
  normalizeFilename,
  toDisplayName,
  boldMissingFile,
  isProtectedFile,
  isHiddenFile,
  nextUntitledFilename,
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
