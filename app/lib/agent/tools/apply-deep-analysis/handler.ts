import type { HandlerResult, Operation } from "../../types"
import type { PostAction, Section, SourceFile } from "./def"
import { ApplyDeepAnalysisArgs, applyDeepAnalysisTool } from "./def"
import { registerTool, tool, getToolHandlers } from "../../executors/tool"
import { getFileView, getViewableFiles } from "../file-view"
import { getFile, getFileRaw } from "~/lib/files/store"
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
  spanKey,
  type MappedResult,
  type VoteRecord,
} from "./format"
import { getStoredAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import {
  type ContentResolver,
  type ScopedSources,
  partitionSources,
  buildCallList,
} from "./messages"
import {
  runDimensionPipeline,
  mergeDimensionResults,
  runReasonStep,
  runFilter,
  runAdjudicate,
  type DimensionResult,
} from "./pipeline"
import type { FindResult } from "./consensus"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { createKeyedQueue } from "~/lib/utils/keyed-queue"
import { writeFileTracked } from "~/lib/files/write-tracked"
import { finalizeContent } from "~/lib/patch/apply"
import { showProgress } from "../../client/store"

interface PhaseTracker {
  tickFind: () => void
  tickFilter: () => void
  tickAdjudicate: () => void
  tickReason: () => void
}

const derivePhaseLabel = (
  finds: number,
  filters: number,
  adjudicates: number,
  reasons: number
): string => {
  if (finds > 0) return "Interpreting dimensions"
  if (filters > 0) return "Cross-referencing findings"
  if (adjudicates > 0) return "Adjudicating disputes"
  if (reasons > 0) return "Building justifications"
  return "Finishing up"
}

const createPhaseTracker = (
  totalFinds: number,
  totalFilters: number,
  totalAdjudicates: number,
  totalReasons: number
): PhaseTracker => {
  let pendingFinds = totalFinds
  let pendingFilters = totalFilters
  let pendingAdjudicates = totalAdjudicates
  let pendingReasons = totalReasons
  const total = totalFinds + totalFilters + totalAdjudicates + totalReasons
  let completed = 0

  const emit = () => {
    const pct = Math.round((completed / total) * 100)
    const label = derivePhaseLabel(pendingFinds, pendingFilters, pendingAdjudicates, pendingReasons)
    showProgress(`${pct}% · ${label}`)
  }

  return {
    tickFind: () => {
      pendingFinds--
      completed++
      emit()
    },
    tickFilter: () => {
      pendingFilters--
      completed++
      emit()
    },
    tickAdjudicate: () => {
      pendingAdjudicates--
      completed++
      emit()
    },
    tickReason: () => {
      pendingReasons--
      completed++
      emit()
    },
  }
}

type Enqueue = <T>(key: string, fn: () => Promise<T>) => Promise<T>

interface PostActionCtx {
  mapped: MappedResult[]
  path: string
  startLine: number
  endLine: number
  warnings: string[]
}

interface SectionResult {
  section: Section
  result: HandlerResult<string>
}

const validateFiles = (
  sections: Section[],
  sourceFiles: SourceFile[]
): HandlerResult<string> | null => {
  const missingTargets = [...new Set(sections.map((s) => s.path))].filter(
    (p) => getFile(p) === undefined
  )
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
  warnings,
}: PostActionCtx): Promise<HandlerResult<string>> => ({
  status: "ok",
  output: formatReturnOutput(mapped, startLine, endLine, warnings),
  mutations: [],
})

const handleAnnotation =
  (action: "annotate_as_code" | "annotate_as_comment", enqueue: Enqueue) =>
  async ({
    mapped,
    path,
    startLine,
    endLine,
    warnings,
  }: PostActionCtx): Promise<HandlerResult<string>> => {
    if (mapped.length === 0)
      return {
        status: "ok",
        output: formatAnnotateOutput(mapped, action, startLine, endLine, warnings),
        mutations: [],
      }

    return enqueue(path, async () => {
      const freshContent = getFileView(path) ?? ""
      const addOps = toAnnotationOps(mapped, action)
      const newCodes = new Set(mapped.map((r) => r.analysis_source_id))
      const removeOps =
        action === "annotate_as_code"
          ? buildRemovalOps(
              getStoredAnnotations(freshContent),
              freshContent,
              newCodes,
              startLine,
              endLine
            )
          : []
      const ops = [...removeOps, ...addOps]
      const annotationResult = await applyAnnotationsEager(path, ops)
      if (annotationResult.status === "error") return annotationResult

      return {
        status: annotationResult.status,
        output: formatAnnotateOutput(mapped, action, startLine, endLine, warnings),
        mutations: [],
      }
    })
  }

type PostActionFn = (ctx: PostActionCtx) => Promise<HandlerResult<string>>

const buildPostActions = (enqueue: Enqueue): Record<PostAction, PostActionFn> => ({
  return: handleReturn,
  annotate_as_code: handleAnnotation("annotate_as_code", enqueue),
  annotate_as_comment: handleAnnotation("annotate_as_comment", enqueue),
})

const processSection = async (
  section: Section,
  scoped: ReturnType<typeof partitionSources>,
  calls: ScopedSources[],
  resolve: ContentResolver,
  postAction: PostActionFn,
  tracker: PhaseTracker
): Promise<HandlerResult<string>> => {
  const { path, start_line, end_line } = section

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
    return {
      status: "ok",
      output: `${path} [${start_line}-${end_line}]: no sentences.`,
      mutations: [],
    }

  const { results: dimensionResults } = await processPool<ScopedSources, DimensionResult>(
    calls,
    async (sources) => [
      await runDimensionPipeline(sources, rawSection, leadingCtx, trailingCtx, resolve),
    ],
    noop,
    { concurrency: 5, onItemComplete: () => tracker.tickFind() }
  )

  const { allSpans, allFindVotes, errors: findErrors } = mergeDimensionResults(dimensionResults)
  const warnings: string[] = []

  if (findErrors.length > 0) {
    warnings.push(...findErrors.map((e) => `find: ${e}`))
  }

  if (allSpans.length === 0 && calls.length > 0 && findErrors.length > 0)
    return { status: "error", output: findErrors.join("; "), mutations: [] }

  const filterResult = await runFilter(
    allSpans,
    sentences,
    scoped,
    leadingCtx,
    trailingCtx,
    resolve
  )
  tracker.tickFilter()

  if (filterResult.errors.length > 0) {
    warnings.push(...filterResult.errors.map((e) => `filter: ${e}`))
  }

  const { dropped: filterDropped, filterVotes, filterJustifications } = filterResult

  const isDisputed = (s: FindResult) =>
    filterJustifications.has(spanKey(s.start, s.end, s.analysis_source_id))
  const disputedSpans = filterResult.surviving.filter(isDisputed)
  const undisputedSpans = filterResult.surviving.filter((s) => !isDisputed(s))

  const adjudicateResult = await runAdjudicate(
    disputedSpans,
    sentences,
    scoped,
    leadingCtx,
    trailingCtx,
    resolve
  )
  tracker.tickAdjudicate()

  if (adjudicateResult.errors.length > 0) {
    warnings.push(...adjudicateResult.errors.map((e) => `adjudicate: ${e}`))
  }

  const surviving = [...undisputedSpans, ...adjudicateResult.surviving]
  const dropped = [...filterDropped, ...adjudicateResult.removed]

  const reasonResult = await runReasonStep(
    surviving,
    sentences,
    scoped,
    leadingCtx,
    trailingCtx,
    resolve
  )
  tracker.tickReason()

  const countVotes = (votes: boolean[]) => {
    const found = votes.filter(Boolean).length
    return { found, missed: votes.length - found }
  }
  const countFilter = (votes: boolean[]) => {
    const keep = votes.filter(Boolean).length
    return { keep, remove: votes.length - keep }
  }

  const voteRecords = new Map<string, VoteRecord>()
  for (const s of surviving) {
    const key = spanKey(s.start, s.end, s.analysis_source_id)
    const findVotes = allFindVotes.get(key) ?? []
    const fVotes = filterVotes.get(key) ?? []
    const review = adjudicateResult.reviews.get(key)
    const vote: VoteRecord = {
      find: countVotes(findVotes),
      filter: countFilter(fVotes),
    }
    if (review !== undefined) vote.review = review
    voteRecords.set(key, vote)
  }

  const analysisResults = toAnalysisResults(surviving, reasonResult.values, voteRecords)
  const mapped = mapResults(sentences, analysisResults)

  const withReview = [...voteRecords.values()].filter((v) => v.review !== undefined).length
  console.debug(
    `[deep-analysis] result: ${allSpans.length} found → ${surviving.length} surviving, ${dropped.length} dropped, ${withReview} with review`
  )

  return postAction({
    mapped,
    path,
    startLine: start_line,
    endLine: end_line,
    warnings,
  })
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
      const validationError = validateFiles(sections, source_files)
      if (validationError) return validationError

      const scoped = partitionSources(source_files)
      const calls = buildCallList(scoped)
      const resolve: ContentResolver = getFileView
      const enqueue = createKeyedQueue()
      const actions = buildPostActions(enqueue)

      const tracker = createPhaseTracker(
        sections.length * calls.length,
        sections.length,
        sections.length,
        sections.length
      )

      showProgress("Preparing deep analysis")
      const { results: sectionResults } = await processPool<Section, SectionResult>(
        sections,
        async (section) => {
          const result = await processSection(
            section,
            scoped,
            calls,
            resolve,
            actions[post_action],
            tracker
          )
          return [{ section, result }]
        },
        noop,
        { concurrency: 5 }
      )

      if (sectionResults.length === 1) return sectionResults[0].result

      return mergeSectionResults(sectionResults)
    },
  })
)
