import type { HandlerResult, Operation } from "../../types"
import type { PostAction, SourceFile } from "./def"
import { ApplyDeepAnalysisArgs, applyDeepAnalysisTool } from "./def"
import { registerTool, tool } from "../../executors/tool"
import { getFileView, getViewableFiles } from "../file-view"
import { getFile } from "~/lib/files/store"
import { getToolHandlers } from "../../executors/tool"
import { CONTEXT_OVERLAP_CHARS } from "~/lib/data-blocks/chunk-lines"
import {
  extractSection,
  extractLeadingContext,
  extractTrailingContext,
  prepareTargetContent,
  numberSection,
  mapResults,
  toAnnotationOps,
  buildRemovalOps,
  formatReturnOutput,
  formatAnnotateOutput,
  toAnalysisResults,
  type MappedResult,
} from "./format"
import { getStoredAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import { type ContentResolver, partitionSources, buildCallList } from "./messages"
import { runDimensionPipeline, mergeDimensionResults, runReasonStep, runFilter } from "./pipeline"

interface PostActionCtx {
  mapped: MappedResult[]
  path: string
  content: string
  startLine: number
  endLine: number
}

const validateFiles = (path: string, sourceFiles: SourceFile[]): HandlerResult<string> | null => {
  if (getFile(path) === undefined)
    return { status: "error", output: `File not found: ${path}`, mutations: [] }

  const missingPaths = sourceFiles.filter((f) => getFile(f.path) === undefined).map((f) => f.path)
  if (missingPaths.length > 0)
    return {
      status: "error",
      output: `Source files not found: ${missingPaths.join(", ")}`,
      mutations: [],
    }

  return null
}

const findNonBlankLine = (lines: string[], from: number, dir: 1 | -1): string => {
  for (let j = from; j >= 0 && j < lines.length; j += dir) {
    if (lines[j].trim()) return lines[j]
  }
  return ""
}

const logSectionBounds = (
  path: string,
  startLine: number,
  endLine: number,
  contentLines: string[]
): void => {
  const firstLine = contentLines[startLine - 1] ?? ""
  const lastLine = contentLines[endLine - 1] ?? ""
  const first = firstLine.trim()
    ? firstLine
    : `(blank, first after: ${findNonBlankLine(contentLines, startLine, 1)})`
  const last = lastLine.trim()
    ? lastLine
    : `(blank, last before: ${findNonBlankLine(contentLines, endLine - 2, -1)})`
  console.debug(`[deep-analysis] ${path} [${startLine}-${endLine}]`)
  console.debug(`[deep-analysis]   first: ${first}`)
  console.debug(`[deep-analysis]   last:  ${last}`)
}

const prepareSectionWithContext = (
  content: string,
  startLine: number,
  endLine: number
): { rawSection: string; leadingCtx: string; trailingCtx: string; sentences: string[] } => {
  const rawSection = extractSection(content, startLine, endLine)
  const leadingCtx = prepareTargetContent(
    extractLeadingContext(content, startLine, CONTEXT_OVERLAP_CHARS)
  )
  const trailingCtx = prepareTargetContent(
    extractTrailingContext(content, endLine, CONTEXT_OVERLAP_CHARS)
  )
  const section = prepareTargetContent(rawSection)
  const { sentences } = numberSection(section)
  return { rawSection, leadingCtx, trailingCtx, sentences }
}

const skipValidation = (mutations: Operation[]): Operation[] =>
  mutations.map((m) => (m.type === "write_file" ? { ...m, skipBlockValidation: true } : m))

const applyAnnotations = async (path: string, ops: unknown[]): Promise<HandlerResult<string>> => {
  const handler = getToolHandlers()["patch_annotations"]
  if (!handler)
    return { status: "error", output: "patch_annotations handler not registered", mutations: [] }

  const files = getViewableFiles()
  const result = await handler(files, { path, operations: ops })

  if (result.status === "error")
    return { status: "error", output: String(result.output), mutations: [] }

  return {
    status: result.status,
    output: String(result.output),
    mutations: skipValidation(result.mutations),
  }
}

const handleReturn = async ({
  mapped,
  startLine,
  endLine,
}: PostActionCtx): Promise<HandlerResult<string>> => ({
  status: "ok",
  output: formatReturnOutput(mapped, startLine, endLine),
  mutations: [],
})

const handleAnnotation =
  (action: "annotate_as_code" | "annotate_as_comment") =>
  async ({
    mapped,
    path,
    content,
    startLine,
    endLine,
  }: PostActionCtx): Promise<HandlerResult<string>> => {
    if (mapped.length === 0)
      return {
        status: "ok",
        output: formatAnnotateOutput(mapped, action, startLine, endLine),
        mutations: [],
      }

    const addOps = toAnnotationOps(mapped, action)
    const newCodes = new Set(mapped.map((r) => r.analysis_source_id))
    const removeOps =
      action === "annotate_as_code"
        ? buildRemovalOps(getStoredAnnotations(content), content, newCodes, startLine, endLine)
        : []
    const ops = [...removeOps, ...addOps]
    const annotationResult = await applyAnnotations(path, ops)
    if (annotationResult.status === "error") return annotationResult

    return {
      status: "ok",
      output: formatAnnotateOutput(mapped, action, startLine, endLine),
      mutations: annotationResult.mutations,
    }
  }

const postActions: Record<PostAction, (ctx: PostActionCtx) => Promise<HandlerResult<string>>> = {
  return: handleReturn,
  annotate_as_code: handleAnnotation("annotate_as_code"),
  annotate_as_comment: handleAnnotation("annotate_as_comment"),
}

registerTool(
  tool({
    ...applyDeepAnalysisTool,
    schema: ApplyDeepAnalysisArgs,
    handler: async (_files, { path, start_line, end_line, source_files, post_action }) => {
      const validationError = validateFiles(path, source_files)
      if (validationError) return validationError

      const content = getFileView(path)
      if (content === undefined)
        return { status: "error", output: `Cannot read file: ${path}`, mutations: [] }

      logSectionBounds(path, start_line, end_line, content.split("\n"))

      const { rawSection, leadingCtx, trailingCtx, sentences } = prepareSectionWithContext(
        content,
        start_line,
        end_line
      )

      if (sentences.length === 0)
        return { status: "ok", output: "Section contains no sentences.", mutations: [] }

      const scoped = partitionSources(source_files)
      const calls = buildCallList(scoped)
      const resolve: ContentResolver = getFileView

      const dimensionResults = await Promise.all(
        calls.map((sources) =>
          runDimensionPipeline(sources, rawSection, leadingCtx, trailingCtx, resolve)
        )
      )

      const { allSpans, errors: findErrors } = mergeDimensionResults(dimensionResults)

      if (allSpans.length === 0 && calls.length > 0 && findErrors.length > 0)
        return { status: "error", output: findErrors.join("; "), mutations: [] }

      const { surviving, dropped } = await runFilter(
        allSpans,
        sentences,
        scoped,
        leadingCtx,
        trailingCtx,
        resolve
      )

      for (const d of dropped) {
        const text = sentences.slice(d.start - 1, d.end).join(" ")
        console.debug(
          `[deep-filter] dropped [${d.start}-${d.end}] ${d.analysis_source_id}: ${text}`
        )
      }

      const reasonResult = await runReasonStep(
        surviving,
        sentences,
        scoped,
        leadingCtx,
        trailingCtx,
        resolve
      )

      const analysisResults = toAnalysisResults(surviving, reasonResult.values)
      const mapped = mapResults(sentences, analysisResults)

      return postActions[post_action]({
        mapped,
        path,
        content,
        startLine: start_line,
        endLine: end_line,
      })
    },
  })
)
