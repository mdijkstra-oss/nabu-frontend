import { getBlocksStrict } from "~/lib/data-blocks/query"
import {
  findBlocksByLanguage,
  formatBlockJson,
  replaceSingletonBlock,
} from "~/lib/data-blocks/parse"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { getFileRaw, setFiles, setPersistEnabled } from "~/lib/files/store"
import { setCacheSkipped } from "~/lib/utils/storage-cache"
import type {
  CodingConfig,
  CodingPassthroughStage,
} from "~/lib/agent/tools/apply-deep-analysis/coding-config"
import type { FilterVoter } from "~/lib/agent/tools/apply-deep-analysis/def"
import { executeDeepAnalysis } from "~/lib/agent/tools/apply-deep-analysis/handler"
import { clearRawCalls, getRawCalls } from "~/lib/agent/client/raw-store"
import "~/lib/agent/tools/block-tools/register"

export const parsePassthrough = (value: string): ReadonlySet<CodingPassthroughStage> => {
  if (value === "") return new Set()
  const stages = value.split(",")
  const valid = new Set(["retrieval", "semantic-filter"])
  const unknown = stages.filter((stage) => !valid.has(stage))
  if (unknown.length > 0) throw new Error(`Unknown passthrough stage(s): ${unknown.join(", ")}`)
  return new Set(stages as CodingPassthroughStage[])
}

export const parseCoders = (value: string): CodingConfig["coders"] => {
  const coders = value.split(",") as FilterVoter[]
  if (coders.length === 1 && coders[0] === "voter-one") return ["voter-one"]
  if (coders.length === 2 && coders[0] === "voter-one" && coders[1] === "voter-two")
    return ["voter-one", "voter-two"]
  throw new Error('--coders must be "voter-one" or "voter-one,voter-two"')
}

export const parseBoolean = (value: string, flag: string): boolean => {
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`--${flag} must be true or false`)
}

const installNodeShims = (): void => {
  setCacheSkipped(true)
  if (typeof globalThis.requestAnimationFrame === "function") return
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    queueMicrotask(() => callback(0))
    return 0
  }
}

export interface CodingCorpusInput {
  documents: { path: string; markdown: string }[]
  frameworkPath: string
  frameworkMarkdown: string
  dimensions: { path: string; markdown: string }[]
}

export type CodingDocumentStatus = "success" | "empty" | "partial" | "failed" | "malformed"

export interface CodingRequestMetadata {
  endpoint: string
  durationMs: number | null
  attempts: number
  retryReasons: string[]
  providerMetadata: Record<string, string>
}

export interface CodingFileResult {
  path: string
  status: CodingDocumentStatus
  generatedMarkdown: string
  annotationCount: number | null
  warnings: string[]
  failures: string[]
}

export interface CodingCorpusResult {
  documents: CodingFileResult[]
  latencyMs: number
  requests: CodingRequestMetadata[]
  retries: number
}

export const classifyCodingOutput = (
  pipeline: Awaited<ReturnType<typeof executeDeepAnalysis>>,
  generatedMarkdown: string
): Pick<CodingFileResult, "status" | "annotationCount" | "warnings" | "failures"> => {
  if (pipeline.status === "error")
    return {
      status: "failed",
      annotationCount: null,
      warnings: [],
      failures: [String(pipeline.output)],
    }
  if (pipeline.status === "partial")
    return {
      status: "partial",
      annotationCount: null,
      warnings: [pipeline.message ?? String(pipeline.output)],
      failures: [],
    }
  const blocks = findBlocksByLanguage(generatedMarkdown, "json-annotations")
  const parsed = getBlocksStrict(generatedMarkdown, "json-annotations", AnnotationsBlockSchema)
  if (blocks.length !== 1 || parsed.length !== 1)
    return {
      status: "malformed",
      annotationCount: null,
      warnings: [],
      failures: ["Generated document has no single schema-valid json-annotations block"],
    }
  return {
    status: parsed[0].annotations.length === 0 ? "empty" : "success",
    annotationCount: parsed[0].annotations.length,
    warnings: [],
    failures: [],
  }
}

const requestMetadata = (): { requests: CodingRequestMetadata[]; retries: number } => {
  const raw = getRawCalls()
  const repeated = new Map<string, number>()
  for (const call of raw) {
    const key = `${call.endpoint}\0${call.requestBody}`
    repeated.set(key, (repeated.get(key) ?? 0) + 1)
  }
  return {
    requests: raw.map((call) => ({
      endpoint: call.endpoint,
      durationMs: call.duration,
      attempts: call.attempts,
      retryReasons: call.retryReasons,
      providerMetadata: call.providerMetadata,
    })),
    retries:
      raw.reduce((total, call) => total + call.retryReasons.length, 0) +
      [...repeated.values()].reduce((total, count) => total + Math.max(0, count - 1), 0),
  }
}

export const runCodingCorpus = async (
  input: CodingCorpusInput,
  pipelineDeps: Parameters<typeof executeDeepAnalysis>[2] = {},
  config: CodingConfig = {
    passthrough: new Set(["retrieval", "semantic-filter"]),
    coders: ["voter-one"],
    adjudicate: false,
  }
): Promise<CodingCorpusResult> => {
  if (input.documents.length === 0) throw new Error("No coding documents supplied")
  if (input.dimensions.length === 0) throw new Error("No coding dimensions supplied")
  installNodeShims()
  setPersistEnabled(false)
  setCacheSkipped(true)
  clearRawCalls()
  setFiles({
    ...Object.fromEntries(input.documents.map((document) => [document.path, document.markdown])),
    [input.frameworkPath]: input.frameworkMarkdown,
    ...Object.fromEntries(
      input.dimensions.map((dimension) => [dimension.path, dimension.markdown])
    ),
  })
  const started = performance.now()
  const pipeline = await executeDeepAnalysis(
    {
      targets: input.documents.map((document) => ({ path: document.path })),
      source_files: [
        { path: input.frameworkPath, scope: "framework" },
        ...input.dimensions.map((dimension) => ({
          path: dimension.path,
          scope: "dimension" as const,
        })),
      ],
      post_action: "annotate_as_code",
    },
    config,
    pipelineDeps
  )
  const documents = input.documents.map((document): CodingFileResult => {
    let generatedMarkdown = getFileRaw(document.path)
    if (
      pipeline.status === "ok" &&
      findBlocksByLanguage(generatedMarkdown, "json-annotations").length === 0
    ) {
      generatedMarkdown = replaceSingletonBlock(
        generatedMarkdown,
        "json-annotations",
        formatBlockJson({ annotations: [] })
      )
    }
    return {
      path: document.path,
      generatedMarkdown,
      ...classifyCodingOutput(pipeline, generatedMarkdown),
    }
  })
  return {
    documents,
    latencyMs: Math.round(performance.now() - started),
    ...requestMetadata(),
  }
}
