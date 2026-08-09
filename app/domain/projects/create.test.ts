import { describe, expect, it } from "vitest"
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
