import { describe, it, expect, afterEach } from "vitest"
import { readdirSync, readFileSync, existsSync } from "fs"
import { join } from "path"
import { applyFilePatch } from "./apply"
import { setFiles } from "~/lib/files/store"
import type { FileStore } from "~/lib/files/store"
import { j } from "./test-helpers"

const scenariosDir = join(__dirname, "scenarios")

const parsePathFromPatch = (patch: string): string => {
  const match = patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)
  if (!match) throw new Error("Patch must include *** Update/Add/Delete File: path")
  return match[1]
}

const loadScenarios = (subdir: string) =>
  readdirSync(join(scenariosDir, subdir)).map((name) => {
    const dir = join(scenariosDir, subdir, name)
    const content = readFileSync(join(dir, "input.md"), "utf-8")
    const patch = readFileSync(join(dir, "patch.txt"), "utf-8")
    const path = parsePathFromPatch(patch)

    const expectedPath = join(dir, "expected.md")
    const errorPath = join(dir, "error.txt")

    if (existsSync(expectedPath)) {
      return {
        name,
        path,
        content,
        patch,
        expected: readFileSync(expectedPath, "utf-8"),
        error: null,
      }
    }
    if (existsSync(errorPath)) {
      return { name, path, content, patch, expected: null, error: readFileSync(errorPath, "utf-8") }
    }
    throw new Error(`Scenario ${name} needs expected.md or error.txt`)
  })

describe("valid", () => {
  const scenarios = loadScenarios("valid")

  it.each(scenarios)("$name", ({ path, content, patch, expected }) => {
    const result = applyFilePatch(path, content, patch)
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.content).toBe(expected)
    }
  })
})

describe("range ref resolves against pretty content", () => {
  afterEach(() => setFiles({}))

  const SOURCE_RAW = j(
    "# Source Notes",
    "",
    "## Section A",
    "",
    "Some prose here.",
    "",
    "```json-attributes",
    "{",
    '\t"summary": "Line one.\\nLine two continues.\\nLine three wraps up."',
    "}",
    "```",
    "",
    "## Section B",
    "",
    "More prose."
  )

  interface Case {
    name: string
    store: FileStore
    targetPath: string
    targetContent: string
    patch: string
    expected: string
  }

  const cases: Case[] = [
    {
      name: "anchors use boundary comments from injected view",
      store: { "source.md": SOURCE_RAW },
      targetPath: "target.md",
      targetContent: "# Target\n",
      patch: j(
        "*** Update File: target.md",
        "@@",
        "+<< source.md",
        "+  ## Section A",
        "+  ...",
        "+  // end json-attributes",
        "+  ```"
      ),
      expected: j(
        "# Target",
        "## Section A",
        "",
        "Some prose here.",
        "",
        "## Section B",
        "",
        "More prose.",
        "",
        "```json-attributes",
        "{",
        '\t"summary": "Line one.\\nLine two continues.\\nLine three wraps up."',
        "}",
        "```",
        ""
      ),
    },
  ]

  it.each(cases)("$name", ({ store, targetPath, targetContent, patch, expected }) => {
    setFiles({ ...store, [targetPath]: targetContent })
    const result = applyFilePatch(targetPath, targetContent, patch)
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.content).toBe(expected)
    }
  })
})

describe("invalid", () => {
  const scenarios = loadScenarios("invalid")

  it.each(scenarios)("$name", ({ path, content, patch, error }) => {
    const result = applyFilePatch(path, content, patch)
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.error).toBe(error)
    }
  })
})
