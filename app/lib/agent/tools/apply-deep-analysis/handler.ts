import type { HandlerResult, Operation } from "../../types"
import type { Target, SourceFile } from "./def"
import { ApplyDeepAnalysisArgs, applyDeepAnalysisTool } from "./def"
import { registerTool, tool, getToolHandlers } from "../../executors/tool"
import { getFileView, getViewableFiles } from "../file-view"
import { getFile, getFileRaw, getFiles } from "~/lib/files/store"
import {
  formatReturnOutput,
  formatAnnotateOutput,
  countConfidence,
  buildSynthesisDirective,
  type MappedResult,
} from "./format"
import { getStoredAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import {
  partitionSources,
  expandDimensions,
  extractDimensionIds,
  validateFrameworkNoCallouts,
} from "./messages"
import { clearAnnotationsOnSection } from "./step-clear"
import { runAnalysisPipeline } from "./pipeline"
import { runFind, type SearchCtx } from "./step-find"
import { createKeyedQueue } from "~/lib/utils/keyed-queue"
import { writeFileTracked } from "~/lib/files/write-tracked"
import { finalizeContent } from "~/lib/patch/apply"
import { think, STARTING, READING_FRAMEWORK, WRITING } from "./thoughts"
import { getDatabase } from "~/domain/db/database"
import { getEmbeddingsUrl } from "~/lib/embeddings/env"
import { buildSemanticContext } from "~/domain/corpus/init"
import { executeSearchById } from "~/domain/search/execute"
import type { SearchHit } from "~/domain/search/types"
import { createTracer } from "./trace"
import type { Envelope } from "./envelope"

const SEARCH_RESOLVE_TARGET = 200

type Enqueue = <T>(key: string, fn: () => Promise<T>) => Promise<T>

interface TargetResult {
  target: Target
  result: HandlerResult<string>
  confirmed: number
  reviewed: number
}

const validateTargets = (
  targets: Target[],
  sourceFiles: SourceFile[]
): HandlerResult<string> | null => {
  const filePaths = targets.map((t) => t.path)
  const missingTargets = [...new Set(filePaths)].filter((p) => getFileView(p) === undefined)
  if (missingTargets.length > 0)
    return {
      status: "error",
      output: `Files not found: ${missingTargets.join(", ")}`,
      mutations: [],
    }

  const missingSources = sourceFiles.filter((f) => getFile(f.path) === undefined).map((f) => f.path)
  if (missingSources.length > 0)
    return {
      status: "error",
      output: `Source files not found: ${missingSources.join(", ")}`,
      mutations: [],
    }

  return null
}

const charOffsetToLine = (content: string, offset: number): number => {
  let line = 1
  const cap = Math.min(offset, content.length)
  for (let i = 0; i < cap; i++) {
    if (content[i] === "\n") line++
  }
  return line
}

const hitToTarget = (hit: SearchHit): Target | null => {
  const content = getFileView(hit.file)
  if (content === undefined) return null
  if (hit.chunkStart === undefined || hit.chunkEnd === undefined) {
    return { path: hit.file }
  }
  return {
    path: hit.file,
    start_line: charOffsetToLine(content, hit.chunkStart),
    end_line: charOffsetToLine(content, hit.chunkEnd),
  }
}

const resolveTargetLines = (target: Target): { start: number; end: number } => {
  const content = getFileView(target.path) ?? ""
  const start = target.start_line ?? 1
  const end = target.end_line ?? content.split("\n").length
  return { start, end }
}

const applyAnnotationsEager = async (
  path: string,
  ops: unknown[]
): Promise<HandlerResult<string>> => {
  const handler = getToolHandlers()["patch_annotations"]
  if (!handler)
    return { status: "error", output: "patch_annotations handler not registered", mutations: [] }

  const files = getViewableFiles()
  const result = await handler(files, { path, operations: ops })

  if (result.status === "error")
    return { status: "error", output: String(result.output), mutations: [] }

  for (const mutation of result.mutations) {
    if (mutation.type !== "write_file") continue
    const oldContent = getFileRaw(mutation.path)
    const finalized = finalizeContent(mutation.path, mutation.content, {
      original: oldContent,
      actor: "ai",
      skipImmutableCheck: true,
      skipSemanticValidation: true,
    })
    if (finalized.status === "error")
      return { status: "error", output: finalized.error, mutations: [] }
    writeFileTracked(mutation.path, finalized.content, "ai")
  }

  return { status: result.status, output: String(result.output), mutations: [] }
}

const envelopeToMapped = (e: Envelope): MappedResult => ({
  text: e.markedText,
  analysis_source_id: e.code,
  reason: e.reason ?? "",
  vote: {
    find: { found: e.findVotes.filter(Boolean).length, missed: 0 },
    ...(e.review !== undefined ? { review: e.review } : {}),
  },
})

const overlapsTargetRange = (
  e: Envelope,
  target: Target,
  contentByPath: Map<string, string>
): boolean => {
  if (e.file !== target.path) return false
  if (target.start_line === undefined && target.end_line === undefined) return true
  const content = contentByPath.get(target.path) ?? ""
  const envStartLine = charOffsetToLine(content, e.fileCharStart)
  const envEndLine = charOffsetToLine(content, e.fileCharEnd)
  const tStart = target.start_line ?? 1
  const tEnd = target.end_line ?? Number.MAX_SAFE_INTEGER
  return envStartLine <= tEnd && envEndLine >= tStart
}

const groupEnvelopesByTarget = (
  envelopes: readonly Envelope[],
  targets: readonly Target[]
): Map<Target, Envelope[]> => {
  const contentByPath = new Map<string, string>()
  for (const t of targets) {
    if (!contentByPath.has(t.path)) {
      contentByPath.set(t.path, getFileView(t.path) ?? "")
    }
  }
  const out = new Map<Target, Envelope[]>()
  for (const t of targets) out.set(t, [])
  for (const e of envelopes) {
    const owner = targets.find((t) => overlapsTargetRange(e, t, contentByPath))
    if (!owner) continue
    const list = out.get(owner)
    if (list) list.push(e)
  }
  return out
}

interface AddOp {
  op: "add_annotation"
  item: { text: string; reason: string; code?: string; color?: string; vote?: MappedResult["vote"] }
}

const DEFAULT_COMMENT_COLOR = "blue"

const toAddOps = (
  mapped: readonly MappedResult[],
  action: "annotate_as_code" | "annotate_as_comment",
  lockedTexts: ReadonlySet<string>
): AddOp[] =>
  mapped
    .filter((m) => !lockedTexts.has(m.text))
    .map((m) =>
      action === "annotate_as_code"
        ? {
            op: "add_annotation" as const,
            item: { text: m.text, reason: m.reason, code: m.analysis_source_id, vote: m.vote },
          }
        : {
            op: "add_annotation" as const,
            item: {
              text: m.text,
              reason: `[${m.analysis_source_id}] ${m.reason}`,
              color: DEFAULT_COMMENT_COLOR,
              vote: m.vote,
            },
          }
    )

interface WriteCtx {
  enqueue: Enqueue
  action: "annotate_as_code" | "annotate_as_comment"
  analyzedCodes: ReadonlySet<string>
}

const writeAnnotationsForTarget = async (
  target: Target,
  mapped: MappedResult[],
  ctx: WriteCtx
): Promise<HandlerResult<string>> =>
  ctx.enqueue(target.path, async () => {
    const freshContent = getFileView(target.path) ?? ""
    const lines = resolveTargetLines(target)

    const clearResult =
      ctx.action === "annotate_as_code"
        ? clearAnnotationsOnSection(
            getStoredAnnotations(freshContent),
            freshContent,
            ctx.analyzedCodes,
            lines.start,
            lines.end
          )
        : { ops: [] }

    const lockedTexts = new Set(
      getStoredAnnotations(freshContent)
        .filter((a) => a.locked === true)
        .map((a) => a.text)
    )
    const addOps = toAddOps(mapped, ctx.action, lockedTexts)

    const ops = [...clearResult.ops, ...addOps]
    if (ops.length === 0)
      return {
        status: "ok" as const,
        output: formatAnnotateOutput(mapped, ctx.action, lines.start, lines.end),
        mutations: [],
      }
    const annotationResult = await applyAnnotationsEager(target.path, ops)
    if (annotationResult.status === "error") return annotationResult
    return {
      status: annotationResult.status,
      output: formatAnnotateOutput(mapped, ctx.action, lines.start, lines.end),
      mutations: [],
    }
  })

const targetLabel = (t: Target): string => {
  const start = t.start_line ?? 1
  const end = t.end_line ?? "end"
  return `${t.path} [${start}-${end}]`
}

const mergeTargetResults = (targetResults: TargetResult[]): HandlerResult<string> => {
  const outputs: string[] = []
  const allMutations: Operation[] = []
  const failed: string[] = []

  for (const { target, result } of targetResults) {
    outputs.push(`## ${targetLabel(target)}\n${result.output}`)
    allMutations.push(...result.mutations)
    if (result.status === "error") failed.push(targetLabel(target))
  }

  const total = targetResults.length
  const output = outputs.join("\n\n")

  if (failed.length === 0) return { status: "ok", output, mutations: allMutations }

  if (failed.length === total) return { status: "error", output, mutations: allMutations }

  return {
    status: "partial",
    output,
    message: `${total - failed.length}/${total} targets completed. Failed: ${failed.join(", ")}`,
    mutations: allMutations,
  }
}

const sumConfidence = (results: readonly TargetResult[]): { confirmed: number; reviewed: number } =>
  results.reduce(
    (acc, r) => ({ confirmed: acc.confirmed + r.confirmed, reviewed: acc.reviewed + r.reviewed }),
    { confirmed: 0, reviewed: 0 }
  )

const degradeWithWarnings = (
  result: HandlerResult<string>,
  warnings: readonly string[]
): HandlerResult<string> => {
  if (warnings.length === 0 || result.status === "error") return result
  const note = `${warnings.length} analysis sub-call(s) failed and were dropped:\n${warnings.map((w) => `- ${w}`).join("\n")}`
  return {
    ...result,
    status: "partial",
    message: result.message ? `${result.message}\n${note}` : note,
  }
}

const appendSynthesisDirective = (
  result: HandlerResult<string>,
  flat: readonly TargetResult[],
  enabled: boolean
): HandlerResult<string> => {
  if (!enabled) return result
  const { confirmed, reviewed } = sumConfidence(flat)
  const directive = buildSynthesisDirective(confirmed, reviewed)
  if (directive === "") return result
  return { ...result, output: `${result.output}${directive}` }
}

registerTool(
  tool({
    ...applyDeepAnalysisTool,
    schema: ApplyDeepAnalysisArgs,
    handler: async (
      _files,
      { targets: inputTargets, search_id, source_files, post_action, synthesize }
    ) => {
      let targets: Target[]
      if (search_id) {
        const hits = await executeSearchById(search_id, SEARCH_RESOLVE_TARGET)
        if (!hits.ok)
          return {
            status: "error",
            output: `Failed to resolve search "${search_id}": ${hits.error}`,
            mutations: [],
          }
        targets = hits.value.map(hitToTarget).filter((t): t is Target => t !== null)
        if (targets.length === 0)
          return {
            status: "error",
            output: `No usable hits returned for search "${search_id}"`,
            mutations: [],
          }
      } else {
        targets = inputTargets ?? []
      }

      if (targets.length === 0)
        return {
          status: "error",
          output: "Provide either targets or search_id",
          mutations: [],
        }

      const validationError = validateTargets(targets, source_files)
      if (validationError) return validationError

      const scoped = partitionSources(source_files)

      if (post_action === "annotate_as_code") {
        const mismatch = validateFrameworkNoCallouts(scoped.framework, getFileView)
        if (mismatch) return { status: "error", output: mismatch, mutations: [] }
      }

      const expanded = expandDimensions(scoped, getFileView)

      const db = getDatabase()
      if (!db)
        return { status: "error", output: "Database not ready. Try again shortly.", mutations: [] }
      const semCtx = await buildSemanticContext(db, getEmbeddingsUrl())
      const frameworkText = scoped.framework
        .map((p) => getFileView(p))
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .join("\n\n")
      const searchCtx: SearchCtx = {
        ctx: semCtx,
        files: getFiles(),
        framework: frameworkText,
        resolveFile: getFileView,
      }

      const scope = targets[0]?.path ?? "target"
      const tracer = createTracer()
      tracer.setTarget(scope)

      think(STARTING)
      think(READING_FRAMEWORK)

      const find = await runFind(targets, expanded.dimension, searchCtx, tracer)

      const analyzedCodes = new Set(extractDimensionIds([scoped], getFileView))

      const pipelineResult = await runAnalysisPipeline(
        find.envelopes,
        scoped,
        getFileView,
        scope,
        tracer
      )
      tracer.flush()

      const warnings = [...find.errors, ...pipelineResult.errors]
      if (warnings.length > 0) console.warn("[deep-analysis] degraded sub-calls:", warnings)

      if (pipelineResult.envelopes.length === 0 && warnings.length > 0) {
        return {
          status: "error",
          output: `Deep analysis failed — no spans produced:\n${warnings.map((w) => `- ${w}`).join("\n")}`,
          mutations: [],
        }
      }

      think(WRITING)

      const grouped = groupEnvelopesByTarget(pipelineResult.envelopes, targets)
      const enqueue = createKeyedQueue()

      const flat: TargetResult[] = []
      for (const target of targets) {
        const envs = grouped.get(target) ?? []
        const mapped = envs.map(envelopeToMapped)
        const lines = resolveTargetLines(target)

        let result: HandlerResult<string>
        if (post_action === "return") {
          result = {
            status: "ok",
            output: formatReturnOutput(mapped, lines.start, lines.end),
            mutations: [],
          }
        } else {
          result = await writeAnnotationsForTarget(target, mapped, {
            enqueue,
            action: post_action,
            analyzedCodes,
          })
        }
        const { confirmed, reviewed } = countConfidence(mapped)
        flat.push({ target, result, confirmed, reviewed })
      }

      const merged = flat.length === 1 ? flat[0].result : mergeTargetResults(flat)
      const degraded = degradeWithWarnings(merged, warnings)
      return appendSynthesisDirective(degraded, flat, synthesize === true)
    },
  })
)
