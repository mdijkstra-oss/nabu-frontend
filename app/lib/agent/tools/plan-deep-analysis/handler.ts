import type { Block } from "../../client/blocks"
import type { FileEntry } from "../file-entry"
import { labelSection } from "../scout-map"
import { planDeepAnalysisTool, PlanDeepAnalysisArgs } from "./def"
import { registerTool, tool } from "../../executors/tool"
import { presentContent } from "../scout/prose"
import { getFileView } from "../file-view"
import { getFile } from "~/lib/files/store"
import { pushBlocks, getAllBlocks } from "../../client/store"
import { activatePlan } from "../../executors/modes"
import { processPool } from "~/lib/utils/pool"
import { PREFERENCES_FILE } from "~/lib/files/filename"
import { getFiles } from "~/lib/files/store"
import { buildAutoSteps, buildExecRules, toSectionMatches, formatTargetFile } from "./format"
import type { LabeledTarget, SourceEntry } from "./format"
import { errorMessage } from "~/lib/utils/error"
import { filterTarget } from "../scout-filter/api"
import type { NumberedParagraph } from "../scout-filter/messages"
import { packComposites, sortSegments } from "~/lib/composite/pack"
import type { Segment } from "~/lib/composite/pack"
import { chunkLines, CHUNK_TARGET_CHARS, type LineChunk } from "~/lib/data-blocks/chunk-lines"
import type { SourceFileEntry } from "./def"

const toSystemBlock = (content: string): Block => ({ type: "system", content })

const READ_MARKER = "## READ MEMORY"
const RECENCY_THRESHOLD = 15

const findMissingFiles = (files: FileEntry[]): string[] =>
  files.filter((f) => getFile(f.path) === undefined).map((f) => f.path)

const formatSourceBlock = (path: string, content: string): string => `File: ${path}\n${content}`

const pushSourceBlocks = (sourceFiles: SourceFileEntry[]): void => {
  for (const file of sourceFiles) {
    const content = getFileView(file.path)
    if (content === undefined) continue
    pushBlocks([toSystemBlock(formatSourceBlock(file.path, content))])
  }
}

const buildFramework = (sourceFiles: SourceFileEntry[]): string =>
  sourceFiles
    .filter((f) => f.group === "framework")
    .map((f) => getFileView(f.path) ?? "")
    .filter((c) => c.length > 0)
    .join("\n\n")

const paragraphSeparator = (): string => "\n\n"

const isInSameChunk = (chunks: LineChunk[], lineA: number, lineB: number): boolean =>
  chunks.some(
    (c) => lineA >= c.startLine && lineA <= c.endLine && lineB >= c.startLine && lineB <= c.endLine
  )

const groupConsecutiveRuns = (
  paragraphs: NumberedParagraph[],
  chunks: LineChunk[]
): NumberedParagraph[][] => {
  if (paragraphs.length === 0) return []
  const runs: NumberedParagraph[][] = [[paragraphs[0]]]

  for (let i = 1; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const currentRun = runs[runs.length - 1]
    const prev = currentRun[currentRun.length - 1]
    const isConsecutive = p.index === prev.index + 1
    const sameChunk = isInSameChunk(chunks, prev.startLine, p.startLine)
    if (isConsecutive && sameChunk) {
      currentRun.push(p)
    } else {
      runs.push([p])
    }
  }
  return runs
}

const chunkRun = (run: NumberedParagraph[], path: string, maxChars: number): Segment[] => {
  const segments: Segment[] = []
  let chunk: NumberedParagraph[] = []
  let chunkSize = 0

  for (const p of run) {
    const added = chunkSize > 0 ? p.text.length + 2 : p.text.length
    if (chunkSize > 0 && chunkSize + added > maxChars) {
      segments.push({
        path,
        startLine: chunk[0].startLine,
        endLine: chunk[chunk.length - 1].endLine,
        content: chunk.map((c) => c.text).join("\n\n"),
      })
      chunk = []
      chunkSize = 0
    }
    chunk.push(p)
    chunkSize += added
  }

  if (chunk.length > 0) {
    segments.push({
      path,
      startLine: chunk[0].startLine,
      endLine: chunk[chunk.length - 1].endLine,
      content: chunk.map((c) => c.text).join("\n\n"),
    })
  }
  return segments
}

const mergeAndChunk = (
  paragraphs: NumberedParagraph[],
  path: string,
  maxChars: number,
  chunks: LineChunk[]
): Segment[] =>
  groupConsecutiveRuns(paragraphs, chunks).flatMap((run) => chunkRun(run, path, maxChars))

const filterAndLabelTarget = async (
  path: string,
  content: string,
  framework: string
): Promise<LabeledTarget[]> => {
  const { surviving } = await filterTarget(framework, content)

  if (surviving.length === 0) return []

  const chunks = chunkLines(content, CHUNK_TARGET_CHARS)
  const segments = mergeAndChunk(surviving, path, CHUNK_TARGET_CHARS, chunks)

  const sorted = sortSegments(segments)
  const composites = packComposites(sorted, CHUNK_TARGET_CHARS, paragraphSeparator)

  const indexed = composites.map((composite, index) => ({ index, composite }))

  const { results, failures } = await processPool(
    indexed,
    async ({ index, composite }) => {
      const presented = presentContent(composite.content)
      const label = await labelSection(presented)
      const ranges = composite.segments.map((s) => ({ startLine: s.startLine, endLine: s.endLine }))
      const target: LabeledTarget = { path, label: label.label, desc: label.desc, ranges }
      return [{ index, target }]
    },
    () => undefined,
    { concurrency: 10, warmup: 1 }
  )

  if (failures.length > 0) {
    const details = failures.map((f) => errorMessage(f.error)).join("; ")
    throw new Error(
      `scout-filter labeling failed for ${path}: ${failures.length} chunk(s): ${details}`
    )
  }

  return (results as { index: number; target: LabeledTarget }[])
    .sort((a, b) => a.index - b.index)
    .map((r) => r.target)
}

const filterAndLabelTargets = async (
  targetFiles: FileEntry[],
  framework: string
): Promise<LabeledTarget[]> => {
  const allTargets: LabeledTarget[] = []

  const { failures } = await processPool(
    targetFiles,
    async (file: FileEntry) => {
      const content = getFileView(file.path)
      if (content === undefined) throw new Error(`Cannot read: ${file.path}`)
      const targets = await filterAndLabelTarget(file.path, content, framework)
      allTargets.push(...targets)
      return []
    },
    () => undefined,
    { concurrency: 3 }
  )

  if (failures.length > 0) {
    const details = failures.map((f) => `${(f.item as FileEntry).path}: ${errorMessage(f.error)}`)
    throw new Error(`Scout-filter failed:\n${details.join("\n")}`)
  }

  return allTargets
}

const groupByPath = (labeled: LabeledTarget[]): Map<string, LabeledTarget[]> => {
  const map = new Map<string, LabeledTarget[]>()
  for (const t of labeled) {
    const group = map.get(t.path)
    if (group) group.push(t)
    else map.set(t.path, [t])
  }
  return map
}

const pushTargetBlocks = (labeled: LabeledTarget[]): void => {
  for (const [path, targets] of groupByPath(labeled)) {
    pushBlocks([toSystemBlock(formatTargetFile(path, targets))])
  }
}

const isMemoryRecent = (blocks: Block[]): boolean => {
  let actionCount = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.type === "system" && block.content.includes(READ_MARKER)) return true
    if (block.type === "text" || block.type === "tool_call") actionCount++
    if (actionCount >= RECENCY_THRESHOLD) return false
  }
  return false
}

const injectMemory = (): void => {
  const preferences = getFiles()[PREFERENCES_FILE] ?? null
  const blocks = getAllBlocks()
  if (!isMemoryRecent(blocks) && preferences) {
    pushBlocks([
      toSystemBlock(
        `${READ_MARKER}\n<file ${PREFERENCES_FILE}>\n${preferences}\n</file ${PREFERENCES_FILE}>`
      ),
    ])
  }
}

registerTool(
  tool({
    ...planDeepAnalysisTool,
    schema: PlanDeepAnalysisArgs,
    handler: async (_files, { source_files, target_files, post_action, interactive }) => {
      const missing = findMissingFiles([...source_files, ...target_files])
      if (missing.length > 0)
        return { status: "error", output: `Files not found: ${missing.join(", ")}`, mutations: [] }

      pushSourceBlocks(source_files)
      const framework = buildFramework(source_files)

      let labeled: LabeledTarget[]
      try {
        labeled = await filterAndLabelTargets(target_files, framework)
      } catch (e) {
        return { status: "error", output: errorMessage(e), mutations: [] }
      }

      pushTargetBlocks(labeled)
      injectMemory()

      const matches = toSectionMatches(labeled)
      if (matches.length === 0) return { status: "ok", output: "ok", mutations: [] }

      const sourceEntries: SourceEntry[] = source_files.map((f) => ({
        path: f.path,
        scope: f.group,
      }))
      const steps = buildAutoSteps(matches, sourceEntries, post_action, interactive)
      const task = `Deep analysis: ${[...new Set(labeled.map((t) => t.path))].join(", ")}`
      activatePlan(task, steps, [])
      const directive = buildExecRules(steps[0].expected)

      return { status: "ok", output: "ok", directive, mutations: [] }
    },
  })
)
