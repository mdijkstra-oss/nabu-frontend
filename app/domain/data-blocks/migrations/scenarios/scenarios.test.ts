import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, existsSync, statSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { migrateFile } from "~/lib/data-blocks/migrate"
import { migrations } from "../index"

const __dirname = dirname(fileURLToPath(import.meta.url))

interface Scenario {
  name: string
  input: string
  expected: string
  changed: boolean
}

const loadScenarios = (): Scenario[] =>
  readdirSync(__dirname)
    .filter((name) => statSync(join(__dirname, name)).isDirectory())
    .sort()
    .map((name) => {
      const dir = join(__dirname, name)
      const input = readFileSync(join(dir, "input.md"), "utf-8")
      const expectedPath = join(dir, "expected.md")
      const hasExpected = existsSync(expectedPath)
      const expected = hasExpected ? readFileSync(expectedPath, "utf-8") : input

      return { name, input, expected, changed: hasExpected }
    })

const maskGeneratedIds = (markdown: string): string =>
  markdown.replace(/"table-[0-9a-z]+"/g, '"table-<generated>"')

describe("migration scenarios", () => {
  const scenarios = loadScenarios()

  it.each(scenarios)("$name", ({ input, expected, changed }) => {
    const result = migrateFile(input, migrations)
    expect(result.changed).toBe(changed)
    expect(maskGeneratedIds(result.markdown)).toBe(maskGeneratedIds(expected))
  })

  const changedScenarios = scenarios.filter((s) => s.changed)

  it.each(changedScenarios)("$name — idempotent", ({ expected }) => {
    const second = migrateFile(expected, migrations)
    expect(second.changed).toBe(false)
    expect(second.markdown).toBe(expected)
  })
})
