import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { createExecutor } from "../../../../executors/execute"
import { getToolHandlers } from "../../../../executors/tool"
import "../../register"
import { setFiles, getFile } from "~/lib/files/store"
import { clearEntries } from "~/lib/mutation-history/store"

const __dirname = dirname(fileURLToPath(import.meta.url))

interface PatchCall {
  tool: string
  args: { path: string; operations: unknown[] }
}

const findBalancedArrayEnd = (text: string, startIdx: number): number => {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === "\\") escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "[") depth++
    else if (ch === "]") {
      depth--
      if (depth === 0) return i
    }
  }
  throw new Error("unbalanced array in patch dump")
}

const stripPathLine = (lines: string[]): { rest: string; path: string } => {
  const pathLine = lines.find((l) => /^\s*path:/.test(l))
  if (!pathLine) throw new Error("missing path: line")
  const path = pathLine.replace(/^\s*path:\s*/, "").trim()
  const rest = lines.filter((l) => l !== pathLine).join("\n")
  return { rest, path }
}

const stripTrailingCommas = (json: string): string => json.replace(/,(\s*[}\]])/g, "$1")

const extractOperations = (text: string): unknown[] => {
  const opsIdx = text.indexOf("operations:")
  if (opsIdx === -1) throw new Error("missing operations: key")
  const arrStart = text.indexOf("[", opsIdx)
  if (arrStart === -1) throw new Error("missing [ after operations:")
  const arrEnd = findBalancedArrayEnd(text, arrStart)
  const raw = text.slice(arrStart, arrEnd + 1)
  return JSON.parse(stripTrailingCommas(raw))
}

const parsePatchDump = (text: string): PatchCall => {
  const lines = text.split("\n").filter((l) => l.length > 0)
  const tool = lines[0].trim()
  const { rest, path } = stripPathLine(lines.slice(1))
  const operations = extractOperations(rest)
  return { tool, args: { path, operations } }
}

const FIXTURE_PATH = join(__dirname, "..", "fixtures", "annotations-persconferentie.md")
const DUMP_PATH = join(__dirname, "2020-08-14-add.patch.txt")

const executor = createExecutor(getToolHandlers())

describe("patch-text dump", () => {
  afterEach(() => {
    setFiles({})
    clearEntries()
  })

  it("parses dump, runs against persconferentie fixture", async () => {
    const fixture = readFileSync(FIXTURE_PATH, "utf-8")
    const dump = readFileSync(DUMP_PATH, "utf-8")

    const call = parsePatchDump(dump)
    setFiles({ [call.args.path]: fixture })

    const result = await executor({ id: "test", name: call.tool, args: call.args })

    const after = getFile(call.args.path) ?? ""

    console.log("---PATCH DUMP RESULT---")
    console.log("status:", result.status)
    console.log("output:", result.output)
    console.log("file changed:", after !== fixture)
    console.log("file head:\n", after.slice(0, 600))
    console.log("file tail:\n", after.slice(-600))
    console.log("---END---")

    expect(result.status).toBeDefined()
  })
})
