import { describe, it, expect, beforeAll, vi } from "vitest"
import type { FileStore } from "~/lib/files/store"

// The schema string is injected into the agent's system prompt as its own block
// and cached there. Prompt caching is prefix-based, so a project with fifty doc
// tables must produce the same bytes as one with none.
const schemaWith = async (files: FileStore): Promise<string> => {
  vi.resetModules()
  const { setFiles, withoutPersist } = await import("~/lib/files/store")
  withoutPersist(() => setFiles(files))
  const { getDatabaseSchema } = await import("./database")
  return getDatabaseSchema()
}

const docTable = (id: string, caption: string): string =>
  [
    "```json-table",
    JSON.stringify(
      {
        id,
        caption: { label: caption },
        columns: [
          { key: "month", name: "Month", type: "date" },
          { key: "amount", name: "Amount", type: "number" },
        ],
        rows: [{ month: "2026-01-01", amount: "42" }],
      },
      null,
      "\t"
    ),
    "```",
  ].join("\n")

const withoutTables: FileStore = {
  "notes.md": "# Notes\n\nSome prose.\n",
}

const withFiftyTables: FileStore = {
  "notes.md": [
    "# Notes",
    "",
    "Some prose.",
    "",
    ...Array.from({ length: 50 }, (_, i) => docTable(`table-doc${i}`, `Table ${i}`)),
    "",
  ].join("\n"),
}

describe("the database schema handed to the agent", () => {
  let none = ""
  let fifty = ""

  // Two resets, so the two reads cannot share the forever-cache that would make
  // the comparison vacuous. Each re-imports the whole registry graph, which runs
  // past vitest's default when both projects contend for the machine.
  beforeAll(async () => {
    none = await schemaWith(withoutTables)
    fifty = await schemaWith(withFiftyTables)
  }, 60_000)

  it("is byte-identical whether the project holds fifty doc tables or none", () => {
    expect(fifty).toBe(none)
  })

  it("names no doc table", () => {
    expect(fifty).not.toMatch(/table_/)
    expect(fifty).not.toContain("Table 0")
  })

  it("keeps json-table out of the static projection set", async () => {
    const { getProjectedConfigs, getPerBlockProjectedConfigs } =
      await import("~/lib/data-blocks/registry")

    expect(getPerBlockProjectedConfigs().map(([language]) => language)).toContain("json-table")
    expect(getProjectedConfigs().map(([language]) => language)).not.toContain("json-table")
  })
})
