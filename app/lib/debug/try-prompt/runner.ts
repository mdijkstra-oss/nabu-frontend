import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import mri from "mri"
import type { FileStore } from "~/lib/files/store"
import type { RecorderHandle } from "./recorder"
import { errorMessage } from "~/lib/utils/error"
import { UsageError, type DebugAgent, type RunInput } from "./agents/types"
import { describeIssues } from "./issues"
import { flagsOf, renderFlagLines } from "./flag-help"
import { hasFailed, noun, render, type ReportView, type RunOutcome } from "./report"

export interface RunIo {
  out: (text: string) => void
  err: (text: string) => void
}

export const consoleIo: RunIo = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
}

export const EXIT_OK = 0
export const EXIT_RUN_FAILED = 1
export const EXIT_USAGE = 2

export const INVOCATION = "npx vite-node scripts/try-prompt.ts --"

const BASE_BOOLEAN_FLAGS = ["requests", "replies-only", "constructed-only", "help"] as const
const BASE_VALUE_FLAGS = ["count"] as const
const BASE_FLAGS = new Set<string>([...BASE_BOOLEAN_FLAGS, ...BASE_VALUE_FLAGS])

export const run = async (
  argv: string[],
  recorder: RecorderHandle,
  registry: DebugAgent[],
  io: RunIo = consoleIo
): Promise<number> => {
  const flags: Flags = mri(argv, {
    boolean: [...BASE_BOOLEAN_FLAGS],
    string: [...BASE_VALUE_FLAGS],
    default: { count: 1 },
  })
  const [agentName, path] = flags._.map(String)

  if (!agentName) return usage(io, listingText(registry), EXIT_OK)
  const agent = registry.find((candidate) => candidate.name === agentName)
  if (!agent)
    return usage(io, `Unknown agent: ${agentName}\n\n${listingText(registry)}`, EXIT_USAGE)
  if (flags.help) return usage(io, agentHelpText(agent), EXIT_OK)

  const invalid =
    invalidBaseFlags(flags) ??
    invalidPath(path, agent) ??
    unknownFlags(flags, agent) ??
    flagsWithoutValue(flags, agent)
  if (invalid) return usage(io, `${invalid}\n\n${agentHelpText(agent)}`, EXIT_USAGE)

  const extras = agent.extras.safeParse(extrasOf(flags, agent))
  if (!extras.success) {
    return usage(
      io,
      `${describeIssues(extras.error, flagName).join("\n")}\n\n${agentHelpText(agent)}`,
      EXIT_USAGE
    )
  }

  const files = readFiles(path, agent.input)
  const view = viewOf(flags)
  const count = Number(flags.count)
  let worst = EXIT_OK
  for (let number = 1; number <= count; number++) {
    await recorder.drain()
    const iteration = count > 1 ? { number, of: count } : undefined
    const outcome = await runOnce(agent, { files, extras: extras.data })
    const calls = await recorder.drain()
    if (outcome.usage && number === 1 && calls.length === 0)
      return usage(io, outcome.message, EXIT_USAGE)
    const exit = Math.max(outcome.exit, calls.some(hasFailed) ? EXIT_RUN_FAILED : EXIT_OK)
    const report = render({
      agent: { name: agent.name, constructedLabel: agent.constructedLabel },
      path,
      calls,
      constructed: outcome.constructed,
      outcome: outcome.report,
      view,
      showRequests: Boolean(flags.requests),
      iteration,
    })
    io.out(report)
    worst = Math.max(worst, exit)
  }
  return worst
}

type Flags = Record<string, unknown> & { _: string[] }

interface Attempt {
  exit: number
  usage: boolean
  constructed: unknown
  report: RunOutcome
  message: string
}

const runOnce = async (
  agent: DebugAgent,
  runInput: RunInput<Record<string, unknown>>
): Promise<Attempt> => {
  try {
    const constructed = await agent.run(runInput)
    return { exit: EXIT_OK, usage: false, constructed, report: { kind: "completed" }, message: "" }
  } catch (error) {
    const message = errorMessage(error)
    return {
      exit: EXIT_RUN_FAILED,
      usage: error instanceof UsageError,
      constructed: undefined,
      report: { kind: "rejected", message },
      message,
    }
  }
}

const usage = (io: RunIo, text: string, exit: number): number => {
  ;(exit === EXIT_OK ? io.out : io.err)(text)
  return exit
}

const listingText = (registry: DebugAgent[]): string => {
  const width = Math.max(0, ...registry.map((agent) => agent.name.length))
  return [
    `Usage: ${INVOCATION} <agent> <path> [flags]`,
    "",
    "  Runs one model-backed feature against a file and prints every raw reply",
    "  next to what the app built from them. Judges nothing.",
    "",
    "Agents:",
    ...registry.map(
      (agent) => `  ${agent.name.padEnd(width)}  ${agent.input.padEnd(9)}  ${agent.summary}`
    ),
    "",
    `Flags every agent takes: ${baseFlagLines().join("; ")}`,
    `  ${INVOCATION} <agent> --help lists that agent's own flags.`,
  ].join("\n")
}

const baseFlagLines = (): string[] => [
  "--count <n> repeats the whole run n times",
  "--requests includes request bodies",
  "--replies-only",
  "--constructed-only",
]

const agentHelpText = (agent: DebugAgent): string => {
  const own = renderFlagLines(flagsOf(agent.extras))
  return [
    `Usage: ${INVOCATION} ${agent.name} <${agent.input}> [flags]`,
    "",
    `  ${agent.summary}`,
    `  Constructs: ${agent.constructedLabel}.`,
    "",
    ...(own.length > 0 ? ["Flags:", ...own] : ["Takes no flags of its own."]),
    "",
    "Every agent also takes:",
    ...baseFlagLines().map((line) => `  ${line}`),
  ].join("\n")
}

const invalidBaseFlags = (flags: Flags): string | undefined => {
  const count = Number(flags.count)
  if (!Number.isInteger(count) || count < 1) return `--count must be a whole number of 1 or more`
  if (flags["replies-only"] && flags["constructed-only"])
    return "--replies-only and --constructed-only exclude each other"
  return undefined
}

const flagsWithoutValue = (flags: Flags, agent: DebugAgent): string | undefined => {
  const bare = Object.keys(agent.extras.shape).filter((key) => flags[key] === true)
  return bare.length > 0 ? `${bare.map(dashed).join(", ")}: a value is required` : undefined
}

const unknownFlags = (flags: Flags, agent: DebugAgent): string | undefined => {
  const known = new Set([...BASE_FLAGS, ...Object.keys(agent.extras.shape)])
  const unknown = Object.keys(flags).filter((key) => key !== "_" && !known.has(key))
  return unknown.length > 0
    ? `Unknown ${noun("flag", unknown.length)}: ${unknown.map(dashed).join(", ")}`
    : undefined
}

const invalidPath = (path: string | undefined, agent: DebugAgent): string | undefined => {
  if (!path) return `Missing the <${agent.input}> path`
  if (!existsSync(path)) return `No such file or directory: ${path}`
  const isDirectory = statSync(path).isDirectory()
  if (agent.input === "file" && isDirectory)
    return `${agent.name} takes a file; ${path} is a directory`
  if (agent.input === "directory" && !isDirectory)
    return `${agent.name} takes a directory; ${path} is a file`
  return undefined
}

const extrasOf = (flags: Flags, agent: DebugAgent): Record<string, string> =>
  Object.fromEntries(
    Object.keys(agent.extras.shape)
      .filter((key) => flags[key] !== undefined)
      .map((key) => [key, stringifyFlag(flags[key])])
  )

const stringifyFlag = (value: unknown): string =>
  Array.isArray(value) ? value.map(String).join(",") : String(value)

const dashed = (name: string): string => `--${name}`

const flagName = (path: PropertyKey[]): string =>
  path.length === 0 ? "flags" : dashed(path.map(String).join("."))

const viewOf = (flags: Flags): ReportView =>
  flags["replies-only"] ? "replies-only" : flags["constructed-only"] ? "constructed-only" : "both"

const readFiles = (path: string, input: DebugAgent["input"]): FileStore =>
  input === "file" ? { [basename(path)]: readFileSync(path, "utf-8") } : readDirectory(path)

const readDirectory = (dir: string): FileStore =>
  Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => [name, readFileSync(join(dir, name), "utf-8")])
  )
