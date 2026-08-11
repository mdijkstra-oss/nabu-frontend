import { describe, it, expect } from "vitest"
import { buildDocumentEntries, landingFile, sortDocuments, type DocumentEntry } from "./selectors"

const entry = (over: Partial<DocumentEntry>): DocumentEntry => ({
  id: "f.md",
  title: "Title",
  date: "",
  editedAt: "",
  tags: [],
  annotationCount: 0,
  ...over,
})

describe("buildDocumentEntries", () => {
  const files = {
    "alpha.md": "alpha body",
    "beta.md": "beta body",
    "notes.hidden.md": "hidden body",
  }
  const getTags = (f: string) => (f === "alpha.md" ? ["t1"] : [])
  const getDate = (f: string) => (f === "alpha.md" ? "2024-12-18" : undefined)

  const cases = [
    {
      name: "excludes hidden files when includeHidden is false",
      includeHidden: false,
      expectedIds: ["alpha.md", "beta.md"],
    },
    {
      name: "includes hidden files when includeHidden is true",
      includeHidden: true,
      expectedIds: ["alpha.md", "beta.md", "notes.hidden.md"],
    },
  ]

  cases.forEach(({ name, includeHidden, expectedIds }) => {
    it(name, () => {
      const out = buildDocumentEntries(files, getTags, getDate, includeHidden)
      expect(out.map((d) => d.id)).toEqual(expectedIds)
    })
  })

  it("carries date, editedAt and tags from the resolvers", () => {
    const [alpha] = buildDocumentEntries(files, getTags, getDate, false)
    expect(alpha.date).toBe("2024-12-18")
    expect(alpha.editedAt.length).toBeGreaterThan(0)
    expect(alpha.tags).toEqual(["t1"])
  })
})

describe("sortDocuments", () => {
  const a = entry({ id: "a", title: "Apple", date: "2024-12-10" })
  const b = entry({ id: "b", title: "Banana", date: "2024-12-18" })
  const c = entry({ id: "c", title: "Cherry", date: "" })

  const cases = [
    { name: "name sorts alphabetically", mode: "name" as const, expected: ["a", "b", "c"] },
    {
      name: "date sorts newest first, dated before undated",
      mode: "date" as const,
      expected: ["b", "a", "c"],
    },
  ]

  cases.forEach(({ name, mode, expected }) => {
    it(name, () => {
      expect(sortDocuments([c, a, b], mode).map((d) => d.id)).toEqual(expected)
    })
  })

  it("does not mutate the input", () => {
    const input = [b, a]
    sortDocuments(input, "name")
    expect(input.map((d) => d.id)).toEqual(["b", "a"])
  })
})

describe("landingFile", () => {
  const cases = [
    {
      name: "skips preferences when another document exists",
      files: ["preferences.md", "welcome.md"],
      expected: "welcome.md",
    },
    {
      name: "lands on preferences when it is all there is",
      files: ["settings.hidden.md", "preferences.md"],
      expected: "preferences.md",
    },
    {
      name: "skips hidden and companion files",
      files: ["settings.hidden.md", "notes.embeddings.hidden.md", "notes.md"],
      expected: "notes.md",
    },
    { name: "keeps document order", files: ["b.md", "a.md"], expected: "b.md" },
    { name: "no visible file", files: ["settings.hidden.md"], expected: undefined },
  ]

  cases.forEach(({ name, files, expected }) => {
    it(name, () => {
      expect(landingFile(files)).toBe(expected)
    })
  })
})
