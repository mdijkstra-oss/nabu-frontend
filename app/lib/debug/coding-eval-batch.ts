import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import mri from "mri"
import type { CodingEvalDataset } from "./coding-eval-dataset"
import type { CodingConfig } from "~/lib/agent/tools/apply-deep-analysis/coding-config"
import { parseBoolean, parseCoders, parsePassthrough } from "./coding-eval"

export const DEFAULT_CODING_GOLD_DIR = resolve(homedir(), "Desktop/ptc-gold-small")
export const DEFAULT_CODING_GATEWAY = "http://localhost:8081"
export const CODING_ENDPOINT = "/deep-analysis-filter.voter-one"

export interface CodingBatchArgs {
  goldDir: string
  output: string
  gateway: string
  config: CodingConfig
  promptRoot: string | null
  promptHash: string | null
}

export const CODING_BATCH_HELP = `Usage: npm run eval:coding:batch -- [options]

Options:
  --gold-dir <path>             Gold dataset (default: ${DEFAULT_CODING_GOLD_DIR})
  --output <path>               New output directory (required; never overwritten)
  --documents-in-flight <n>     Compatibility flag; only 1 is accepted
  --gateway <url>               Gateway (default: VITE_LLM_HOST, then ${DEFAULT_CODING_GATEWAY})
  --passthrough <stages>        Comma-separated retrieval,semantic-filter (default: both)
  --coders <coders>             voter-one or voter-one,voter-two (default: voter-one)
  --adjudicate <boolean>        Whether to adjudicate two voters (default: false)
  --prompt-root <path>          Explicit immutable candidate prompt root
  --prompt-hash <sha256>        Candidate guidance hash recorded in the manifest
  --help                        Show this help

All corpus documents enter one pipeline invocation. The pipeline may pack
chunks from different files into the same model request.`

export const parseCodingBatchArgs = (argv: string[]): CodingBatchArgs | { help: true } => {
  const args = mri(argv, {
    string: [
      "gold-dir",
      "output",
      "documents-in-flight",
      "gateway",
      "passthrough",
      "coders",
      "adjudicate",
      "prompt-root",
      "prompt-hash",
    ],
    boolean: ["help"],
  })
  if (args.help) return { help: true }
  if (args._.length > 0) throw new Error(`Unexpected argument(s): ${args._.join(", ")}`)
  if (typeof args.output !== "string" || args.output.length === 0)
    throw new Error("Missing --output\n\n" + CODING_BATCH_HELP)
  const rawInFlight = args["documents-in-flight"] ?? "1"
  const documentsInFlight = Number(rawInFlight)
  if (documentsInFlight !== 1)
    throw new Error(
      "--documents-in-flight must be 1 because the corpus uses one pipeline invocation"
    )
  const gateway =
    (typeof args.gateway === "string" && args.gateway) ||
    process.env.VITE_LLM_HOST ||
    DEFAULT_CODING_GATEWAY
  return {
    goldDir: typeof args["gold-dir"] === "string" ? args["gold-dir"] : DEFAULT_CODING_GOLD_DIR,
    output: args.output,
    gateway: gateway.replace(/\/$/, ""),
    config: {
      passthrough: parsePassthrough(args.passthrough ?? "retrieval,semantic-filter"),
      coders: parseCoders(args.coders ?? "voter-one"),
      adjudicate: parseBoolean(args.adjudicate ?? "false", "adjudicate"),
    },
    promptRoot: typeof args["prompt-root"] === "string" ? resolve(args["prompt-root"]) : null,
    promptHash: typeof args["prompt-hash"] === "string" ? args["prompt-hash"] : null,
  }
}

export const preflightCodingGateway = async (
  gateway: string,
  fetcher: typeof fetch = fetch
): Promise<void> => {
  let response: Response
  try {
    response = await fetcher(`${gateway.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) {
    throw new Error(
      `Coding gateway is unavailable at ${gateway}/health: ${
        error instanceof Error ? error.message : String(error)
      }\nConfigure nabu-prompts/.env, run \`docker compose up -d chancery\` there, and verify /health.`
    )
  }
  if (!response.ok)
    throw new Error(
      `Coding gateway health check failed at ${gateway}/health (${response.status}).\nConfigure nabu-prompts/.env, run \`docker compose up -d chancery\` there, and verify /health.`
    )
}

export const assertCodingWorkerResult = (
  exitCode: number | null,
  returnedPaths: readonly string[],
  expectedPaths: readonly string[],
  diagnostics: string
): void => {
  if (exitCode !== 0) throw new Error(diagnostics || `Coding worker exited with status ${exitCode}`)
  if (
    returnedPaths.length !== new Set(returnedPaths).size ||
    returnedPaths.length !== expectedPaths.length ||
    expectedPaths.some((path) => !returnedPaths.includes(path))
  )
    throw new Error("Coding worker returned an incomplete or unexpected document set")
}

const hashFiles = (paths: readonly string[]): string | null => {
  if (paths.length === 0) return null
  const hash = createHash("sha256")
  paths.forEach((path) => hash.update(`${basename(path)}\0${readFileSync(path)}\n`))
  return hash.digest("hex")
}

const filesBelow = (path: string): string[] => {
  if (!existsSync(path)) return []
  if (statSync(path).isFile()) return [path]
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => filesBelow(resolve(path, entry.name)))
    .sort()
}

const promptsMetadata = (
  args: CodingBatchArgs
): {
  root: string | null
  promptHash: string | null
  modelTable: string | null
  modelTableHash: string | null
} => {
  if (!args.promptRoot)
    return { root: null, promptHash: args.promptHash, modelTable: null, modelTableHash: null }
  const modelTable = resolve(args.promptRoot, "models.claude-cli.yaml")
  return {
    root: args.promptRoot,
    promptHash:
      args.promptHash ?? hashFiles(filesBelow(resolve(args.promptRoot, "deep-analysis-filter"))),
    modelTable: existsSync(modelTable) ? modelTable : null,
    modelTableHash: hashFiles(filesBelow(modelTable)),
  }
}

const frontendRevision = (): string => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

export const buildCodingRunManifest = (
  dataset: CodingEvalDataset,
  args: CodingBatchArgs
): Record<string, unknown> => ({
  createdAt: new Date().toISOString(),
  dataset: {
    path: dataset.root,
    hash: dataset.datasetHash,
    codebookHash: dataset.codebookHash,
    documents: dataset.documents.map((document) => ({
      name: document.name,
      hash: document.hash,
    })),
  },
  frontendRevision: frontendRevision(),
  prompts: promptsMetadata(args),
  gateway: args.gateway,
  endpoint: CODING_ENDPOINT,
  pipeline: {
    passthrough: [...args.config.passthrough].sort(),
    coders: args.config.coders,
    adjudicate: args.config.adjudicate,
    pipelineInvocations: 1,
    targetDocuments: dataset.documents.length,
  },
})
