import { describe, it, expect, afterEach } from "vitest"
import { createExecutor } from "../../executors/execute"
import { getToolHandlers } from "../../executors/tool"
import "./handler"
import { setFiles, getFile } from "~/lib/files/store"
import { clearEntries } from "~/lib/mutation-history/store"

const executor = createExecutor(getToolHandlers())

const cleanup = () => {
  setFiles({})
  clearEntries()
}

describe("create_file", () => {
  afterEach(cleanup)

  interface Case {
    name: string
    files: Record<string, string>
    args: { path: string; content: string }
    expected:
      | { status: "ok"; contentMatch?: string | RegExp }
      | { status: "error"; errorMatch: string | RegExp }
  }

  const cases: Case[] = [
    {
      name: "creates a new file with raw content",
      files: {},
      args: { path: "notes.md", content: "# Notes\n\nFirst draft.\n" },
      expected: { status: "ok", contentMatch: "First draft" },
    },
    {
      name: "rejects when file already exists",
      files: { "notes.md": "# Existing\n" },
      args: { path: "notes.md", content: "# New\n" },
      expected: { status: "error", errorMatch: /already exists/ },
    },
    {
      name: "rejects content containing a json fence",
      files: {},
      args: {
        path: "notes.md",
        content: "# Notes\n\n```json-annotations\n{}\n```\n",
      },
      expected: { status: "error", errorMatch: /Cannot create.*json-annotations/ },
    },
    {
      name: "downstream rejects non-registered fence languages",
      files: {},
      args: {
        path: "notes.md",
        content: "# Notes\n\n```python\nprint(1)\n```\n",
      },
      expected: { status: "error", errorMatch: /not a known data-block language/ },
    },
  ]

  it.each(cases)("$name", async (c) => {
    setFiles(c.files)
    const result = await executor({ id: "test", name: "create_file", args: c.args })

    expect(result.status, String(result.output)).toBe(c.expected.status)

    if (c.expected.status === "error") {
      expect(String(result.output)).toMatch(c.expected.errorMatch)
      return
    }

    const after = getFile(c.args.path) ?? ""
    if (c.expected.contentMatch) expect(after).toMatch(c.expected.contentMatch)
  })
})
