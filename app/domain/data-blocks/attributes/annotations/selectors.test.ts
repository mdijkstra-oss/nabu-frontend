import { describe, expect, it } from "vitest"
import { getAnnotationGlobalCountsByCode } from "./selectors"
import type { FileStore } from "~/lib/files/store"

interface Ann {
  id: string
  text: string
  reason: string
  code?: string
  color?: string
}

const buildFile = (annotations: Ann[]): string =>
  `# Doc\n\n\`\`\`json-annotations\n${JSON.stringify({ annotations })}\n\`\`\`\n`

const withCode = (id: string, code: string): Ann => ({
  id,
  text: `text ${id}`,
  reason: "why",
  code,
})

const withColor = (id: string, color: string): Ann => ({
  id,
  text: `text ${id}`,
  reason: "why",
  color,
})

describe("getAnnotationGlobalCountsByCode", () => {
  const cases: {
    name: string
    files: FileStore
    expected: Record<string, { count: number; fileCount: number }>
  }[] = [
    {
      name: "empty store",
      files: {},
      expected: {},
    },
    {
      name: "single file single code",
      files: {
        "a.md": buildFile([withCode("1", "theme-a"), withCode("2", "theme-a")]),
      },
      expected: { "theme-a": { count: 2, fileCount: 1 } },
    },
    {
      name: "same code across multiple files",
      files: {
        "a.md": buildFile([withCode("1", "theme-a")]),
        "b.md": buildFile([withCode("2", "theme-a"), withCode("3", "theme-a")]),
        "c.md": buildFile([withCode("4", "theme-a")]),
      },
      expected: { "theme-a": { count: 4, fileCount: 3 } },
    },
    {
      name: "multiple codes in multiple files",
      files: {
        "a.md": buildFile([withCode("1", "theme-a"), withCode("2", "theme-b")]),
        "b.md": buildFile([withCode("3", "theme-a")]),
      },
      expected: {
        "theme-a": { count: 2, fileCount: 2 },
        "theme-b": { count: 1, fileCount: 1 },
      },
    },
    {
      name: "ignores annotations with color only",
      files: {
        "a.md": buildFile([withColor("1", "blue"), withCode("2", "theme-a")]),
      },
      expected: { "theme-a": { count: 1, fileCount: 1 } },
    },
    {
      name: "file without annotations block",
      files: {
        "a.md": "# Just prose\n\nNo annotations here.\n",
        "b.md": buildFile([withCode("1", "theme-a")]),
      },
      expected: { "theme-a": { count: 1, fileCount: 1 } },
    },
  ]

  it.each(cases)("$name", ({ files, expected }) => {
    const result = getAnnotationGlobalCountsByCode(files)
    expect(result).toEqual(expected)
  })
})
