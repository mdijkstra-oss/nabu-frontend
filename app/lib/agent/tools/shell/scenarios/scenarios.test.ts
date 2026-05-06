import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { shellHandler, type ShellCommandOutput } from "../../run-local-shell/handler"
import type { FileStore } from "~/lib/files/store"
import type { Operation } from "../../../types"

const __dirname = dirname(fileURLToPath(import.meta.url))

interface Scenario {
  files: FileStore
  args: { commands: string[] }
  expected: {
    status: "ok" | "partial" | "error"
    output: ShellCommandOutput[]
    mutations: Operation[]
  }
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf-8")) as T

const loadScenarios = (): { name: string; scenario: Scenario }[] =>
  readdirSync(__dirname)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
      name: name.replace(".json", ""),
      scenario: readJson<Scenario>(join(__dirname, name)),
    }))

describe("shell handler scenarios", () => {
  const scenarios = loadScenarios()

  it.each(scenarios)("$name", async ({ scenario }) => {
    const files = new Map(Object.entries(scenario.files))
    const result = await shellHandler(files, scenario.args)

    expect(result.status).toBe(scenario.expected.status)
    expect(result.output).toEqual(scenario.expected.output)
    expect(result.mutations).toEqual(scenario.expected.mutations)
  })
})
