import { describe, it, expect } from "vitest"
import { codeFiles } from "./actions"
import type { CodingFileRef } from "./selectors"

const dims: CodingFileRef[] = [{ file: "codebook.md", hidden: false }]

describe("codeFiles", () => {
  it("single file → one apply_deep_analysis call, no plan", () => {
    const task = codeFiles(["interview_one.md"], dims)
    expect(task.context).toContain("apply_deep_analysis")
    expect(task.context).not.toContain("start_planning")
    expect(task.context).toContain(`{ path: "interview_one.md" }`)
    expect(task.userMessage).toBe("Can you code this file with codebook.md")
  })

  it("multiple files → plan with one step per file", () => {
    const task = codeFiles(["a.md", "b.md", "c.md"], dims)
    expect(task.context).toContain("start_planning")
    expect(task.context).toContain("submit_plan")
    expect(task.context).toContain("complete_step")
    expect(task.context).toContain("3 steps total")
    expect(task.userMessage).toBe("Can you code these 3 files: a.md, b.md & c.md with codebook.md")
  })
})

describe("codeFiles userMessage file preview", () => {
  interface Case {
    name: string
    docs: string[]
    expected: string
  }

  const cases: Case[] = [
    { name: "two files joined", docs: ["a.md", "b.md"], expected: "a.md & b.md" },
    { name: "three files joined", docs: ["a.md", "b.md", "c.md"], expected: "a.md, b.md & c.md" },
    {
      name: "over limit truncates with count",
      docs: ["a.md", "b.md", "c.md", "d.md", "e.md"],
      expected: "a.md, b.md, c.md (+2 more)",
    },
  ]

  it.each(cases)("$name", ({ docs, expected }) => {
    expect(codeFiles(docs, dims).userMessage).toBe(
      `Can you code these ${docs.length} files: ${expected} with codebook.md`
    )
  })
})
