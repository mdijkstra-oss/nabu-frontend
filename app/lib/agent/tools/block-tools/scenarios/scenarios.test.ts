import { describe, it, expect, afterEach } from "vitest"
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { createExecutor } from "../../../executors/execute"
import { getToolHandlers } from "../../../executors/tool"
import "../register"
import { setFiles, getFile } from "~/lib/files/store"
import { clearEntries } from "~/lib/mutation-history/store"

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, "fixtures")
const GENERATE = process.env.UPDATE_SNAPSHOTS === "1"

const GENERATED_ID_RE = /\b(annotation|callout|chart|tag|search)-[a-z0-9]{6,10}\b/g

const extractKnownIds = (content: string): Set<string> => {
  const ids = new Set<string>()
  for (const match of content.matchAll(GENERATED_ID_RE)) ids.add(match[0])
  return ids
}

const stabilizeIds = (content: string, knownIds: Set<string>): string =>
  content.replace(GENERATED_ID_RE, (match, prefix) =>
    knownIds.has(match) ? match : `${prefix}-XXXXXXXX`
  )

interface Expected {
  status: "ok" | "partial" | "error"
  outputMatch: string
  contentMatch?: string
  contentNotMatch?: string
  unchanged?: boolean
}

interface CaseJson {
  name: string
  fixture: string | null
  storePath?: string
  checkPath?: string
  tool: string
  args: Record<string, unknown>
  expected: Expected
  expectedFile?: string
  stabilizeIds?: boolean
}

const executor = createExecutor(getToolHandlers())

const loadFixture = (name: string): string => readFileSync(join(FIXTURES_DIR, name), "utf-8")

const loadCases = (groupDir: string): CaseJson[] =>
  JSON.parse(readFileSync(join(groupDir, "cases.json"), "utf-8")) as CaseJson[]

const getGroups = (): string[] =>
  readdirSync(__dirname, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "fixtures")
    .map((d) => d.name)
    .sort()

const cleanup = () => {
  setFiles({})
  clearEntries()
}

for (const group of getGroups()) {
  const groupDir = join(__dirname, group)
  const cases = loadCases(groupDir)

  describe(group, () => {
    afterEach(cleanup)

    it.each(cases)("$name", async (c: CaseJson) => {
      const storePath = c.storePath ?? (c.args.path as string)
      const checkPath = c.checkPath ?? storePath
      const fixtureContent = c.fixture ? loadFixture(c.fixture) : null

      if (fixtureContent) {
        setFiles({ [storePath]: fixtureContent })
      } else {
        setFiles({})
      }

      const normalizedBefore = getFile(checkPath)
      const result = await executor({ id: "test", name: c.tool, args: c.args })

      expect(result.status, String(result.output)).toBe(c.expected.status)
      expect(String(result.output)).toMatch(new RegExp(c.expected.outputMatch))

      if (c.expected.unchanged) {
        expect(getFile(checkPath)).toBe(normalizedBefore)
      }

      if (c.expected.contentMatch) {
        expect(getFile(checkPath)).toMatch(new RegExp(c.expected.contentMatch))
      }

      if (c.expected.contentNotMatch) {
        expect(getFile(checkPath)).not.toMatch(new RegExp(c.expected.contentNotMatch))
      }

      if (c.expectedFile) {
        const expectedPath = join(groupDir, c.expectedFile)
        const actual = getFile(checkPath) ?? ""
        const knownIds = fixtureContent ? extractKnownIds(fixtureContent) : new Set<string>()
        const stabilized = c.stabilizeIds ? stabilizeIds(actual, knownIds) : actual

        if (GENERATE) {
          writeFileSync(expectedPath, stabilized, "utf-8")
        } else {
          expect(existsSync(expectedPath), `missing expected file: ${c.expectedFile}`).toBe(true)
          const expected = readFileSync(expectedPath, "utf-8")
          expect(stabilized).toBe(expected)
        }
      }
    })
  })
}
