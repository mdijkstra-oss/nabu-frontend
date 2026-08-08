import { describe, it, expect } from "vitest"
import { requestTitleEdit, consumeTitleEdit } from "./title-edit"

describe("title edit intent", () => {
  it("has nothing to consume without a request", () => {
    expect(consumeTitleEdit("untitled.md")).toBe(false)
  })

  it("consumes once for the requested file", () => {
    requestTitleEdit("untitled.md")
    expect(consumeTitleEdit("untitled.md")).toBe(true)
    expect(consumeTitleEdit("untitled.md")).toBe(false)
  })

  it("ignores other files and keeps the request pending", () => {
    requestTitleEdit("untitled.md")
    expect(consumeTitleEdit("other.md")).toBe(false)
    expect(consumeTitleEdit("untitled.md")).toBe(true)
  })

  it("keeps only the latest request", () => {
    requestTitleEdit("a.md")
    requestTitleEdit("b.md")
    expect(consumeTitleEdit("a.md")).toBe(false)
    expect(consumeTitleEdit("b.md")).toBe(true)
  })
})
