import type { HandlerResult, Operation } from "../../types"
import type { PostAction, Section, SourceFile } from "./def"
import { ApplyDeepAnalysisArgs, applyDeepAnalysisTool } from "./def"
import { registerTool, tool, getToolHandlers } from "../../executors/tool"
import { getFileView, getViewableFiles } from "../file-view"
import { getFile, getFileRaw } from "~/lib/files/store"
import { CHUNK_TARGET_CHARS } from "~/lib/data-blocks/chunk-lines"
import {
  SECTION_MARKER,
  extractSection,
  extractSentenceContext,
  prepareTargetContent,
  numberSectionWithPositions,
  mapAnnotations,
  toAnnotationOps,
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
  partitionSources,
  buildCallList,
  expandDimensions,
  extractDimensionIds,
  validateFrameworkNoCallouts,
} from "./messages"
import { clearAnnotationsOnSection } from "./step-clear"
import { runAnalysisPipeline } from "./pipeline"
import { createKeyedQueue } from "~/lib/utils/keyed-queue"
import { writeFileTracked } from "~/lib/files/write-tracked"
import { finalizeContent } from "~/lib/patch/apply"
import { FIND_CONTEXT_SENTENCES } from "./def"
import { think, thinkWithName, STARTING, PICKING_UP, READING_FRAMEWORK, WRITING } from "./thoughts"
import { findMatchOffset } from "~/lib/text/find"
import type { Annotation as StoredAnnotation } from "~/domain/data-blocks/attributes/schema"

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

const validateFileSections = (
  sections: Section[],
  sourceFiles: SourceFile[]
): HandlerResult<string> | null => {
  const filePaths = sections.map((s) => s.path)
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

const overlapsWithLocked = (
  text: string,
  lockedTexts: readonly string[],
  sectionText: string
): boolean => {
  const newMatch = findMatchOffset(sectionText, text)
  if (!newMatch) return false
  for (const lt of lockedTexts) {
    const lockedMatch = findMatchOffset(sectionText, lt)
    if (!lockedMatch) continue
    if (newMatch.start < lockedMatch.end && lockedMatch.start < newMatch.end) return true
  }
  return false
}

const filterOverlappingWithLocked = (
  addOps: { op: string; item: { text: string } }[],
  lockedAnnotations: StoredAnnotation[],
  content: string,
  startLine: number,
  endLine: number
): typeof addOps => {
  if (lockedAnnotations.length === 0) return addOps
  const lines = content.split("\n")
  const sectionText = lines.slice(startLine - 1, endLine).join("\n")
  const lockedTexts = lockedAnnotations.map((a) => a.text)
  return addOps.filter((op) => !overlapsWithLocked(op.item.text, lockedTexts, sectionText))
}

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

      const clearResult =
        action === "annotate_as_code"
          ? clearAnnotationsOnSection(
              getStoredAnnotations(freshContent),
              freshContent,
              analyzedCodes,
              startLine,
              endLine
            )
          : { ops: [] }

      const rawAddOps = toAnnotationOps(mapped, action)
      const lockedAnnotations = getStoredAnnotations(freshContent).filter((a) => a.locked === true)
      const addOps = filterOverlappingWithLocked(
        rawAddOps,
        lockedAnnotations,
        freshContent,
        startLine,
        endLine
      )

      const ops = [...clearResult.ops, ...addOps]
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
  postAction: PostActionFn
): Promise<SectionResult[]> => {
  const prepared = prepareTargetContent(composite.content)
  const { sentences, positions } = numberSectionWithPositions(prepared)

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

  const name = composite.segments[0]?.path.split("/").pop() ?? "section"
  think(READING_FRAMEWORK)

  const firstSeg = composite.segments[0]
  const lastSeg = composite.segments[composite.segments.length - 1]
  let leadingCtx = ""
  let trailingCtx = ""
  if (isSingleFileComposite(composite.segments) && firstSeg && lastSeg) {
    const fullContent = getFileView(firstSeg.path) ?? ""
    const ctx = extractSentenceContext(
      fullContent,
      firstSeg.startLine,
      lastSeg.endLine,
      FIND_CONTEXT_SENTENCES
    )
    leadingCtx = ctx.leading
    trailingCtx = ctx.trailing
  }

  const analyzedCodes = new Set(extractDimensionIds(calls, getFileView))

  const firstFile = composite.segments[0]?.path ?? "target"
  const pipelineResult = await runAnalysisPipeline(
    calls,
    composite.content,
    firstFile,
    leadingCtx,
    trailingCtx,
    scoped,
    sentences,
    getFileView
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
    handler: async (_files, { sections, source_files, post_action }) => {
      const validationError = validateFileSections(sections, source_files)
      if (validationError) return validationError

      const scoped = partitionSources(source_files)

      if (post_action === "annotate_as_code") {
        const mismatch = validateFrameworkNoCallouts(scoped.framework, getFileView)
        if (mismatch) return { status: "error", output: mismatch, mutations: [] }
      }

      const calls = buildCallList(expandDimensions(scoped, getFileView))
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
        const results = await processComposite(composite, scoped, calls, actions[post_action])
        flat.push(...results)
      }
      if (flat.length === 1) return flat[0].result

      return mergeSectionResults(flat)
    },
  })
)
