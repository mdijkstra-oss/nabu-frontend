import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import mri from "mri"
import { setLlmHostForProcess } from "~/lib/agent/env"
import {
  parseBoolean,
  parseCoders,
  parsePassthrough,
  runCodingCorpus,
} from "~/lib/debug/coding-eval"
import { parseCodingCorpusJob } from "~/lib/debug/coding-corpus-job"

const args = mri(process.argv.slice(2), {
  string: ["input", "output", "gateway", "passthrough", "coders", "adjudicate"],
})

const required = (name: string): string => {
  const value = args[name]
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing --${name}`)
  return value
}

const main = async (): Promise<void> => {
  const input = parseCodingCorpusJob(JSON.parse(readFileSync(resolve(required("input")), "utf8")))
  const output = resolve(required("output"))
  setLlmHostForProcess(required("gateway"))
  const result = await runCodingCorpus(
    input,
    {},
    {
      passthrough: parsePassthrough(required("passthrough")),
      coders: parseCoders(required("coders")),
      adjudicate: parseBoolean(required("adjudicate"), "adjudicate"),
    }
  )
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(result))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
