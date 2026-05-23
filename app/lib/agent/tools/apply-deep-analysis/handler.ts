import type { HandlerResult, Operation } from "../../types"
import type { PostAction, Section, SourceFile, SectionSourceInput } from "./def"
import { ApplyDeepAnalysisArgs, applyDeepAnalysisTool } from "./def"
import { registerTool, tool, getToolHandlers } from "../../executors/tool"
import { getFileView, getViewableFiles } from "../file-view"
import { getFile, getFileRaw } from "~/lib/files/store"
import { CHUNK_TARGET_CHARS } from "~/lib/data-blocks/chunk-lines"
import { resolveSectionSources, type ResolvedSection } from "~/lib/search/resolve-sections"
import { getDatabase } from "~/domain/db/database"
import { getLlmHost } from "~/lib/agent/env"
import { buildSemanticContext } from "~/domain/corpus/init"
import {
  SECTION_MARKER,
  extractSection,
  extractSentenceContext,
  prepareTargetContent,
  numberSectionWithPositions,
  mapAnnotations,
  toAnnotationOps,
  buildRemovalOps,
  formatReturnOutput,
  formatAnnotateOutput,
  type MappedResult,
} from "./format"
import type { Annotation } from "./types"
import {
  sortSegments,
  packComposites,
  type Segment,
  type Composite,
  type PackedSegment,
} from "~/lib/composite/pack"
import { buildSentenceSegmentMap, resolveSentenceIndex } from "~/lib/composite/sentence-map"
import { getStoredAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import {
  type ContentResolver,
  partitionSources,
  buildCallList,
  expandDimensions,
  extractDimensionIds,
} from "./messages"
import { runAnalysisPipeline } from "./pipeline"
import { createKeyedQueue } from "~/lib/utils/keyed-queue"
import { writeFileTracked } from "~/lib/files/write-tracked"
import { finalizeContent } from "~/lib/patch/apply"
import { FIND_CONTEXT_SENTENCES } from "./def"
import { think, thinkWithName, STARTING, PICKING_UP, READING_FRAMEWORK, WRITING } from "./thoughts"

type Enqueue = <T>(key: string, fn: () => Promise<T>) => Promise<T>

interface PostActionCtx {
  mapped: MappedResult[]
  path: string
  startLine: number
  endLine: number
  sectionTextLength: number
  warnings: string[]
  analyzedCodes: ReadonlySet<string>
}

interface SectionResult {
  section: Section
  result: HandlerResult<string>
}

const isFileSection = (s: SectionSourceInput): s is SectionSourceInput & { type: "file" } =>
  s.type === "file"

const hasQuerySections = (sources: SectionSourceInput[]): boolean =>
  sources.some((s) => s.type === "query")

const resolvedToSection = (r: ResolvedSection): Section => ({
  path: r.path,
  start_line: r.startLine,
  end_line: r.endLine,
})

const validateFileSections = (
  sections: SectionSourceInput[],
  sourceFiles: SourceFile[]
): HandlerResult<string> | null => {
  const filePaths = sections.filter(isFileSection).map((s) => s.path)
  const missingTargets = [...new Set(filePaths)].filter((p) => getFile(p) === undefined)
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

const applyAnnotationsEager = async (
  path: string,
  ops: unknown[]
): Promise<HandlerResult<string>> => {
  const handler = getToolHandlers()["patch_annotations"]
  if (!handler)
    return { status: "error", output: "patch_annotations handler not registered", mutations: [] }

  const files = getViewableFiles()
  console.debug(`[deep-fuzzy] eager: ${ops.length} ops for ${path}`)
  const result = await handler(files, { path, operations: ops })
  console.debug(
    `[deep-fuzzy] eager: result=${result.status} — ${String(result.output).slice(0, 120)}`
  )

  if (result.status === "error")
    return { status: "error", output: String(result.output), mutations: [] }

  for (const mutation of result.mutations) {
    if (mutation.type !== "write_file") continue
    const oldContent = getFileRaw(mutation.path)
    const finalized = finalizeContent(mutation.path, mutation.content, {
      original: oldContent,
      actor: "ai",
      skipImmutableCheck: true,
      skipCodeValidation: true,
    })
    if (finalized.status === "error")
      return { status: "error", output: finalized.error, mutations: [] }
    writeFileTracked(mutation.path, finalized.content)
  }

  return { status: result.status, output: String(result.output), mutations: [] }
}

const handleReturn = async ({
  mapped,
  startLine,
  endLine,
  sectionTextLength,
  warnings,
}: PostActionCtx): Promise<HandlerResult<string>> => ({
  status: "ok",
  output: formatReturnOutput(mapped, startLine, endLine, sectionTextLength, warnings),
  mutations: [],
})

const handleAnnotation =
  (action: "annotate_as_code" | "annotate_as_comment", enqueue: Enqueue) =>
  async ({
    mapped,
    path,
    startLine,
    endLine,
    sectionTextLength,
    warnings,
    analyzedCodes,
  }: PostActionCtx): Promise<HandlerResult<string>> =>
    enqueue(path, async () => {
      const freshContent = getFileView(path) ?? ""
      const addOps = toAnnotationOps(mapped, action)
      const removeOps =
        action === "annotate_as_code"
          ? buildRemovalOps(
              getStoredAnnotations(freshContent),
              freshContent,
              analyzedCodes,
              startLine,
              endLine
            )
          : []
      const ops = [...removeOps, ...addOps]
      if (ops.length === 0)
        return {
          status: "ok" as const,
          output: formatAnnotateOutput(
            mapped,
            action,
            startLine,
            endLine,
            sectionTextLength,
            warnings
          ),
          mutations: [],
        }
      const annotationResult = await applyAnnotationsEager(path, ops)
      if (annotationResult.status === "error") return annotationResult

      return {
        status: annotationResult.status,
        output: formatAnnotateOutput(
          mapped,
          action,
          startLine,
          endLine,
          sectionTextLength,
          warnings
        ),
        mutations: [],
      }
    })

type PostActionFn = (ctx: PostActionCtx) => Promise<HandlerResult<string>>

const buildPostActions = (enqueue: Enqueue): Record<PostAction, PostActionFn> => ({
  return: handleReturn,
  annotate_as_code: handleAnnotation("annotate_as_code", enqueue),
  annotate_as_comment: handleAnnotation("annotate_as_comment", enqueue),
})

const isSingleFileComposite = (segments: readonly { path: string }[]): boolean =>
  segments.length > 0 && segments.every((s) => s.path === segments[0].path)

const compositeSeparator = (seg: Segment): string =>
  `\n\n${SECTION_MARKER}${seg.path} [${seg.startLine}-${seg.endLine}]\n\n`

const toSegments = (sections: Section[]): Segment[] =>
  sections.flatMap((s) => {
    const content = getFileView(s.path)
    if (content === undefined) return []
    return [
      {
        path: s.path,
        startLine: s.start_line,
        endLine: s.end_line,
        content: extractSection(content, s.start_line, s.end_line),
      },
    ]
  })

const groupAnnotationsBySegment = (
  annotations: Annotation[],
  sentenceMap: (PackedSegment | null)[]
): Map<PackedSegment, Annotation[]> => {
  const grouped = new Map<PackedSegment, Annotation[]>()
  for (const a of annotations) {
    const seg = resolveSentenceIndex(sentenceMap, a.start)
    if (!seg) continue
    const list = grouped.get(seg) ?? []
    list.push(a)
    grouped.set(seg, list)
  }
  return grouped
}

const processComposite = async (
  composite: Composite,
  scoped: ReturnType<typeof partitionSources>,
  calls: ReturnType<typeof buildCallList>,
  resolve: ContentResolver,
  postAction: PostActionFn
): Promise<SectionResult[]> => {
  const prepared = prepareTargetContent(composite.content)
  const { sentences, positions } = numberSectionWithPositions(prepared)

  const segmentSummary = composite.segments
    .map((s) => `${s.path} [${s.startLine}-${s.endLine}]`)
    .join(", ")
  console.debug(`[deep-analysis-format] composite segments: ${segmentSummary}`)
  console.debug(
    `[deep-analysis-format] numbered sentences (${sentences.length}):\n${sentences.map((s, i) => `  ${i + 1}: ${s}`).join("\n")}`
  )

  if (sentences.length === 0) {
    return composite.segments.map((seg) => ({
      section: { path: seg.path, start_line: seg.startLine, end_line: seg.endLine },
      result: {
        status: "ok" as const,
        output: `${seg.path} [${seg.startLine}-${seg.endLine}]: no sentences.`,
        mutations: [],
      },
    }))
  }

  for (const seg of composite.segments) {
    const content = resolve(seg.path)
    if (content) logSectionBounds(seg.path, seg.startLine, seg.endLine, content.split("\n"))
  }

  const name = composite.segments[0]?.path.split("/").pop() ?? "section"
  think(READING_FRAMEWORK)

  const firstSeg = composite.segments[0]
  const lastSeg = composite.segments[composite.segments.length - 1]
  let leadingCtx = ""
  let trailingCtx = ""
  if (isSingleFileComposite(composite.segments) && firstSeg && lastSeg) {
    const fullContent = resolve(firstSeg.path) ?? ""
    const ctx = extractSentenceContext(
      fullContent,
      firstSeg.startLine,
      lastSeg.endLine,
      FIND_CONTEXT_SENTENCES
    )
    leadingCtx = ctx.leading
    trailingCtx = ctx.trailing
  }

  const analyzedCodes = new Set(extractDimensionIds(calls, resolve))

  const pipelineResult = await runAnalysisPipeline(
    calls,
    composite.content,
    leadingCtx,
    trailingCtx,
    scoped,
    sentences,
    resolve
  )

  const warnings: string[] = []
  if (pipelineResult.errors.length > 0) {
    warnings.push(...pipelineResult.errors)
  }

  if (pipelineResult.annotations.length === 0 && pipelineResult.errors.length > 0) {
    return composite.segments.map((seg) => ({
      section: { path: seg.path, start_line: seg.startLine, end_line: seg.endLine },
      result: { status: "error" as const, output: pipelineResult.errors.join("; "), mutations: [] },
    }))
  }

  const sentenceMap = buildSentenceSegmentMap(composite, positions)
  const grouped = groupAnnotationsBySegment(pipelineResult.annotations, sentenceMap)

  const withReview = pipelineResult.annotations.filter((a) => a.review !== undefined).length
  console.debug(
    `[deep-analysis] result: ${pipelineResult.annotations.length} surviving, ${withReview} with review`
  )

  thinkWithName(WRITING, name)

  const sectionResults: SectionResult[] = []
  for (const seg of composite.segments) {
    const segAnnotations = grouped.get(seg) ?? []
    const mapped = mapAnnotations(sentences, segAnnotations)
    const segContent = composite.content.slice(seg.charStart, seg.charEnd)
    const sectionTextLength = prepareTargetContent(segContent).length
    const section: Section = { path: seg.path, start_line: seg.startLine, end_line: seg.endLine }
    const result = await postAction({
      mapped,
      path: seg.path,
      startLine: seg.startLine,
      endLine: seg.endLine,
      sectionTextLength,
      warnings,
      analyzedCodes,
    })
    sectionResults.push({ section, result })
  }

  return sectionResults
}

const sectionLabel = (s: Section): string => `${s.path} [${s.start_line}-${s.end_line}]`

const mergeSectionResults = (sectionResults: SectionResult[]): HandlerResult<string> => {
  const outputs: string[] = []
  const allMutations: Operation[] = []
  const failed: string[] = []

  for (const { section, result } of sectionResults) {
    outputs.push(`## ${sectionLabel(section)}\n${result.output}`)
    allMutations.push(...result.mutations)
    if (result.status === "error") failed.push(sectionLabel(section))
  }

  const total = sectionResults.length
  const output = outputs.join("\n\n")

  if (failed.length === 0) return { status: "ok", output, mutations: allMutations }

  if (failed.length === total) return { status: "error", output, mutations: allMutations }

  return {
    status: "partial",
    output,
    message: `${total - failed.length}/${total} sections completed. Failed: ${failed.join(", ")}`,
    mutations: allMutations,
  }
}

registerTool(
  tool({
    ...applyDeepAnalysisTool,
    schema: ApplyDeepAnalysisArgs,
    handler: async (_files, { sections: sectionSources, source_files, post_action }) => {
      const validationError = validateFileSections(sectionSources, source_files)
      if (validationError) return validationError

      let sections: Section[]

      if (hasQuerySections(sectionSources)) {
        const db = getDatabase()
        if (!db)
          return {
            status: "error",
            output: "Database not ready. Try again shortly.",
            mutations: [],
          }
        const ctx = await buildSemanticContext(db, getLlmHost())
        const resolved = await resolveSectionSources(sectionSources, ctx, getFileView)
        if (!resolved.ok) return { status: "error", output: resolved.error, mutations: [] }
        if (resolved.value.length === 0)
          return {
            status: "error",
            output: "Query sections resolved to no file ranges.",
            mutations: [],
          }
        sections = resolved.value.map(resolvedToSection)
      } else {
        sections = sectionSources.filter(isFileSection).map((s) => ({
          path: s.path,
          start_line: s.start_line,
          end_line: s.end_line,
        }))
      }

      const scoped = partitionSources(source_files)
      const resolve: ContentResolver = getFileView
      const calls = buildCallList(expandDimensions(scoped, resolve))
      const enqueue = createKeyedQueue()
      const actions = buildPostActions(enqueue)

      const segments = toSegments(sections)
      const sorted = sortSegments(segments)
      const composites = packComposites(sorted, CHUNK_TARGET_CHARS, compositeSeparator)

      think(STARTING)
      const flat: SectionResult[] = []
      for (const composite of composites) {
        const name = composite.segments[0]?.path.split("/").pop() ?? "section"
        thinkWithName(PICKING_UP, name)
        const results = await processComposite(
          composite,
          scoped,
          calls,
          resolve,
          actions[post_action]
        )
        flat.push(...results)
      }
      if (flat.length === 1) return flat[0].result

      return mergeSectionResults(flat)
    },
  })
)
