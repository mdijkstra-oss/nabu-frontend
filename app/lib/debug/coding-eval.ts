import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import mri from "mri"
import { stripBlocksByLanguage } from "~/lib/data-blocks/parse"
import { getBlock } from "~/lib/data-blocks/query"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { getFileRaw, setFiles, setPersistEnabled } from "~/lib/files/store"
import { setCacheSkipped } from "~/lib/utils/storage-cache"
import type {
  CodingConfig,
  CodingPassthroughStage,
} from "~/lib/agent/tools/apply-deep-analysis/coding-config"
import type { FilterVoter } from "~/lib/agent/tools/apply-deep-analysis/def"
import { executeDeepAnalysis } from "~/lib/agent/tools/apply-deep-analysis/handler"
import "~/lib/agent/tools/block-tools/register"

export interface CodingEvalArgs {
  input: string
  framework: string
  dimensions: string
  output: string
  config: CodingConfig
}

const required = (value: unknown, flag: string): string => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing --${flag}`)
  return value
}

const parsePassthrough = (value: string): ReadonlySet<CodingPassthroughStage> => {
  if (value === "") return new Set()
  const stages = value.split(",")
  const valid = new Set(["retrieval", "semantic-filter"])
  const unknown = stages.filter((stage) => !valid.has(stage))
  if (unknown.length > 0) throw new Error(`Unknown passthrough stage(s): ${unknown.join(", ")}`)
  return new Set(stages as CodingPassthroughStage[])
}

const parseCoders = (value: string): CodingConfig["coders"] => {
  const coders = value.split(",") as FilterVoter[]
  if (coders.length === 1 && coders[0] === "voter-one") return ["voter-one"]
  if (coders.length === 2 && coders[0] === "voter-one" && coders[1] === "voter-two")
    return ["voter-one", "voter-two"]
  throw new Error('--coders must be "voter-one" or "voter-one,voter-two"')
}

const parseBoolean = (value: string, flag: string): boolean => {
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`--${flag} must be true or false`)
}

export const parseCodingEvalArgs = (argv: string[]): CodingEvalArgs => {
  const args = mri(argv, {
    string: ["input", "framework", "dimensions", "output", "passthrough", "coders", "adjudicate"],
  })
  if (args._.length > 0) throw new Error(`Unexpected argument(s): ${args._.join(", ")}`)
  return {
    input: required(args.input, "input"),
    framework: required(args.framework, "framework"),
    dimensions: required(args.dimensions, "dimensions"),
    output: required(args.output, "output"),
    config: {
      passthrough: parsePassthrough(
        typeof args.passthrough === "string"
          ? args.passthrough
          : required(args.passthrough, "passthrough")
      ),
      coders: parseCoders(required(args.coders, "coders")),
      adjudicate: parseBoolean(required(args.adjudicate, "adjudicate"), "adjudicate"),
    },
  }
}

const installNodeShims = (): void => {
  setCacheSkipped(true)
  if (typeof globalThis.requestAnimationFrame === "function") return
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    queueMicrotask(() => callback(0))
    return 0
  }
}

const annotationBlock = (markdown: string, label: string) => {
  const block = getBlock(markdown, "json-annotations", AnnotationsBlockSchema)
  if (!block) throw new Error(`${label} has no schema-valid json-annotations block`)
  return block
}

export const runCodingEval = async (args: CodingEvalArgs): Promise<number> => {
  const input = resolve(args.input)
  const output = resolve(args.output)
  if (input === output) throw new Error("--output must differ from --input")

  const framework = resolve(args.framework)
  const dimensionPaths = readdirSync(resolve(args.dimensions), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => resolve(args.dimensions, entry.name))
    .sort((a, b) => a.localeCompare(b))
  if (dimensionPaths.length === 0) throw new Error("--dimensions contains no Markdown files")

  const files = Object.fromEntries(
    [input, framework, ...dimensionPaths].map((path) => [path, readFileSync(path, "utf8")])
  )
  installNodeShims()
  setPersistEnabled(false)
  setFiles(files)

  const result = await executeDeepAnalysis(
    {
      targets: [{ path: input }],
      source_files: [
        { path: framework, scope: "framework" },
        ...dimensionPaths.map((path) => ({ path, scope: "dimension" as const })),
      ],
      post_action: "annotate_as_code",
    },
    args.config
  )
  if (result.status === "error") throw new Error(String(result.output))

  const generated = getFileRaw(input)
  const block = annotationBlock(generated, "Generated document")
  if (block.annotations.length === 0)
    throw new Error("Generated json-annotations block is valid but empty")
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, generated)
  return block.annotations.length
}

interface Span {
  start: number
  end: number
}

const occurrences = (source: string, text: string): Span[] => {
  if (text.length === 0) return []
  const spans: Span[] = []
  let from = 0
  while (from <= source.length - text.length) {
    const start = source.indexOf(text, from)
    if (start === -1) break
    spans.push({ start, end: start + text.length })
    from = start + 1
  }
  return spans
}

const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end

export interface CodingComparison {
  actual: number
  gold: number
  overlapping: number
}

export const compareCodingMarkdown = (actualRaw: string, goldRaw: string): CodingComparison => {
  const actual = annotationBlock(actualRaw, "Actual document").annotations
  const gold = annotationBlock(goldRaw, "Gold document").annotations
  if (actual.length === 0) throw new Error("Actual json-annotations block is valid but empty")
  const source = stripBlocksByLanguage(goldRaw, "json-annotations")

  const overlapping = actual.filter((generated) => {
    if (!generated.code) return false
    const generatedSpans = occurrences(source, generated.text)
    return gold.some(
      (expected) =>
        expected.code === generated.code &&
        generatedSpans.some((generatedSpan) =>
          occurrences(source, expected.text).some((goldSpan) => overlaps(generatedSpan, goldSpan))
        )
    )
  }).length
  return { actual: actual.length, gold: gold.length, overlapping }
}

export const compareCodingFiles = (actualPath: string, goldPath: string): CodingComparison =>
  compareCodingMarkdown(
    readFileSync(resolve(actualPath), "utf8"),
    readFileSync(resolve(goldPath), "utf8")
  )
