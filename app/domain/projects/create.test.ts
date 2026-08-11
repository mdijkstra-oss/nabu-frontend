import { describe, expect, it } from "vitest"
import { normalizeAsStored } from "~/lib/files/store"
import { validateStructural } from "~/lib/data-blocks/validate"
import { getBlock } from "~/lib/data-blocks/query"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { firstFileCommand, welcomeContent, welcomePath } from "./create"

describe("firstFileCommand", () => {
  const cases = [
    { name: "writes a file", field: "action" as const, expected: "WriteFile" },
    { name: "writes the welcome path", field: "path" as const, expected: welcomePath },
    { name: "writes the welcome text", field: "content" as const, expected: welcomeContent },
  ]

  it.each(cases)("$name", ({ field, expected }) => {
    expect(firstFileCommand()[field]).toBe(expected)
  })

  it("names a path storage accepts", () => {
    expect(welcomePath).toMatch(/^[A-Za-z0-9-_. ()',]+$/)
  })
})

// Seeded straight into storage, so it never passes through the store's write path.
// A malformed block would surface as a corrupt file on the first project the user makes.
describe("welcomeContent", () => {
  it("has no structural errors", () => {
    expect(validateStructural(welcomeContent)).toEqual([])
  })

  it("is already in stored form", () => {
    expect(normalizeAsStored(welcomeContent)).toBe(welcomeContent)
  })

  it("annotates text that is in the prose", () => {
    const annotations = getBlock(
      welcomeContent,
      "json-annotations",
      AnnotationsBlockSchema
    )?.annotations
    expect(annotations?.length).toBeGreaterThan(0)
    annotations?.forEach((a) => expect(welcomeContent).toContain(a.text))
  })
})
