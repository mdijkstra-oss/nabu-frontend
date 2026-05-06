import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import type { Block } from "../../../client/blocks"
import type { Nudger } from "../../nudge-tools"
import { collect } from "../../nudge-tools"
import { buildToolNudges } from "../index"
import { baselineNudge } from "../baseline"

const __dirname = dirname(fileURLToPath(import.meta.url))

const orchestratorToolNames = ["run_local_shell"]

import type { FileStore } from "~/lib/files/store"

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf-8")) as T

const readFilesJson = (path: string): FileStore => {
  if (!existsSync(path)) return {}
  return readJson<FileStore>(path)
}

const shouldNudge = (block: Block): boolean => block.type === "user" || block.type === "tool_result"

const buildNudge = (files: FileStore) => {
  const toolNudges = buildToolNudges(() => files)
  const nudgers: Nudger[] = orchestratorToolNames.flatMap((n) => toolNudges[n] ?? [])
  nudgers.push(baselineNudge)
  return collect(...nudgers)
}

const regenerateScenario = async (name: string): Promise<void> => {
  const basePath = join(__dirname, name, name)
  const input = readJson<Block[]>(`${basePath}.json`)
  const files = readFilesJson(`${basePath}.files.json`)

  const nudge = buildNudge(files)
  const history: Block[] = []
  for (const block of input) {
    history.push(block)
    if (shouldNudge(block)) {
      const nudgeBlocks = await nudge(history)
      for (const n of nudgeBlocks) {
        history.push(n)
      }
    }
  }

  writeFileSync(`${basePath}.expected.json`, JSON.stringify(history, null, 2) + "\n")
  console.log(`Regenerated ${name}`)
}

const getScenarioNames = (): string[] => {
  const entries = readdirSync(__dirname, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

const main = async () => {
  const scenarios = getScenarioNames()
  for (const scenario of scenarios) {
    await regenerateScenario(scenario)
  }
  console.log(`Done. Regenerated ${scenarios.length} scenarios.`)
}

main()
