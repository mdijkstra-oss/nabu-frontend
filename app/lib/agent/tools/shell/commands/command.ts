import { minimatch } from "minimatch"
import mri from "mri"
import type { Files } from "../types"
import { resolveHiddenFile } from "~/lib/files/hidden-blocks"

export type Operation =
  | { type: "create"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "rename"; path: string; newPath: string }

export interface Result {
  output: string
  error?: string
  exitCode?: number
  operations?: Operation[]
}

type Command = CommandDef & {
  createHandler: (files: Files) => (args: string[], stdin: string) => Result
}

export const ok = (output: string, operations?: Operation[]): Result =>
  operations ? { output, operations } : { output }

export const noMatch = (): Result => ({ output: "[no matches]", exitCode: 1 })

export const err = (error: string): Result => ({ output: "", error })

export const normalizePath = (path: string | undefined): string | undefined => {
  if (!path || path === "." || path === "./" || path === "/") return undefined
  if (path.startsWith("./")) return path.slice(2)
  if (path.startsWith("/")) return path.slice(1)
  return path
}

export const isGlob = (pattern: string): boolean => pattern.includes("*") || pattern.includes("?")

const expandGlob = (files: Map<string, string>, pattern: string): string[] =>
  Array.from(files.keys()).filter((f) => minimatch(f, pattern))

export const resolveFiles = (files: Map<string, string>, rawPattern: string): string[] => {
  const pattern = normalizePath(rawPattern)
  if (!pattern) return []
  if (isGlob(pattern)) return expandGlob(files, pattern)
  if (files.has(pattern)) return [pattern]
  return []
}

export const resolveFileContent = (files: Files, filename: string): string | undefined =>
  files.get(filename) ?? resolveHiddenFile(filename)

export const hasFile = (files: Files, filename: string): boolean =>
  files.has(filename) || resolveHiddenFile(filename) !== undefined

interface FlagDef {
  alias?: string
  description: string
  value?: boolean
}
type Handler = (
  args: string[],
  flags: Set<string>,
  stdin: string,
  flagValues: Record<string, string>
) => Result
interface CommandDef {
  description: string
  details?: string
  usage: string
  flags: Record<string, FlagDef>
  skipFlagParsing?: boolean
  handler: (files: Files) => Handler
}

const stripDash = (flag: string): string => flag.replace(/^-+/, "")

interface MriConfig {
  options: mri.Options
  knownFlags: Set<string>
  multiCharFlags: Set<string>
  stringFlags: Set<string>
}

const buildMriConfig = (flagDefs: Record<string, FlagDef>): MriConfig => {
  const boolean: string[] = []
  const string: string[] = []
  const alias: Record<string, string> = {}
  const knownFlags = new Set<string>()
  const multiCharFlags = new Set<string>()
  const stringFlags = new Set<string>()

  for (const [flag, def] of Object.entries(flagDefs)) {
    const name = stripDash(flag)
    knownFlags.add(name)
    if (name.length > 1) multiCharFlags.add(name)

    if (def.value) {
      string.push(name)
      stringFlags.add(name)
    } else {
      boolean.push(name)
    }
    if (def.alias) {
      const aliasName = stripDash(def.alias)
      alias[aliasName] = name // mri expects alias -> canonical, not canonical -> alias
      knownFlags.add(aliasName)
      if (aliasName.length > 1) multiCharFlags.add(aliasName)
      if (def.value) stringFlags.add(aliasName)
    }
  }

  return { options: { boolean, string, alias }, knownFlags, multiCharFlags, stringFlags }
}

const findDefaultNumericFlag = (stringFlags: Set<string>): string | undefined => {
  const singleChar = [...stringFlags].filter((f) => f.length === 1)
  return singleChar.length === 1 ? singleChar[0] : undefined
}

const normalizeArgs = (
  args: string[],
  multiCharFlags: Set<string>,
  stringFlags: Set<string>
): string[] =>
  args.flatMap((arg) => {
    if (!arg.startsWith("-") || arg.startsWith("--")) return [arg]

    const rest = arg.slice(1)

    if (multiCharFlags.has(rest)) return [`--${rest}`]

    if (/^\d+$/.test(rest)) {
      const flag = findDefaultNumericFlag(stringFlags)
      if (flag) return [`-${flag}`, rest]
    }

    if (rest.length > 1 && stringFlags.has(rest[0])) {
      return [`-${rest[0]}`, rest.slice(1)]
    }

    return [arg]
  })

const formatHelp = (flagDefs: Record<string, FlagDef>): string =>
  Object.entries(flagDefs)
    .map(([f, { alias, description }]) => `  ${f}${alias ? `, ${alias}` : ""}: ${description}`)
    .join("\n") || "  (none)"

const createRawHandler = (
  def: CommandDef,
  files: Files
): ((args: string[], stdin?: string) => Result) => {
  const innerHandler = def.handler(files)
  return (args: string[], stdin = ""): Result => innerHandler(args, new Set(), stdin, {})
}

const createParsedHandler = (
  def: CommandDef,
  files: Files
): ((args: string[], stdin?: string) => Result) => {
  const innerHandler = def.handler(files)

  return (args: string[], stdin = ""): Result => {
    const {
      options: mriOptions,
      knownFlags,
      multiCharFlags,
      stringFlags,
    } = buildMriConfig(def.flags)
    const normalized = normalizeArgs(args, multiCharFlags, stringFlags)
    const parsed = mri(normalized, mriOptions)
    const flags = new Set<string>()
    const flagValues: Record<string, string> = {}

    for (const [key, value] of Object.entries(parsed)) {
      if (key === "_") continue

      if (!knownFlags.has(key)) {
        const cmdName = def.usage.split(" ")[0]
        const dashKey = key.length === 1 ? `-${key}` : `--${key}`
        return {
          output: "",
          error: `${cmdName}: unsupported option '${dashKey}'\nSupported:\n${formatHelp(def.flags)}`,
        }
      }

      const canonicalFlag = `-${key}`
      if (value === true) {
        flags.add(canonicalFlag)
      } else if (value !== false && value !== undefined) {
        flags.add(canonicalFlag)
        flagValues[canonicalFlag] = String(value)
      }
    }

    return innerHandler(parsed._ as string[], flags, stdin, flagValues)
  }
}

export const command = (def: CommandDef): Command => {
  const createHandler = (files: Files) =>
    def.skipFlagParsing ? createRawHandler(def, files) : createParsedHandler(def, files)

  return Object.assign({ createHandler }, def)
}
