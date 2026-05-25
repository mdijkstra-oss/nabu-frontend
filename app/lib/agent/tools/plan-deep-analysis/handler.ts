import type { Block } from "../../client/blocks"
import type { FileEntry } from "../file-entry"
import type { ResolvedSection } from "~/lib/search/resolve-sections"
import { labelSection } from "../scout-map"
import { planDeepAnalysisTool, PlanDeepAnalysisArgs } from "./def"
import type { TargetEntry, SourceFileEntry } from "./def"
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
import { packComposites, sortSegments, type Composite } from "~/lib/composite/pack"
import { mergeAndChunk, paragraphSeparator } from "~/lib/composite/merge"
import { chunkLines, CHUNK_TARGET_CHARS } from "~/lib/data-blocks/chunk-lines"
import { stripCodeBlockLines, remapRanges } from "~/lib/data-blocks/strip-lines"
import { validateFrameworkNoCallouts } from "../apply-deep-analysis/messages"
import {
  resolveQueryHits,
  mergeOverlappingRanges,
  executeResolvedQuery,
} from "~/lib/search/resolve-sections"
import { getDatabase } from "~/domain/db/database"
import { getLlmHost } from "~/lib/agent/env"
import { buildSemanticContext } from "~/domain/corpus/init"

const isQueryTarget = (t: FileEntry | TargetEntry): t is TargetEntry & { type: "query" } =>
  "type" in t && t.type === "query"

const resolveQueryTargets = async (
  targets: (FileEntry | TargetEntry)[]
): Promise<{ files: FileEntry[]; queryHits: ResolvedSection[]; errors: string[] }> => {
  const files: FileEntry[] = []
  const queryHits: ResolvedSection[] = []
  const errors: string[] = []

  const db = getDatabase()

  for (const target of targets) {
    if (!isQueryTarget(target)) {
      files.push({ path: target.path, group: target.group })
      continue
    }

    if (!db) {
      errors.push(`No database available to execute query: ${target.sql}`)
      continue
    }

    const ctx = await buildSemanticContext(db, getLlmHost())
    const result = await executeResolvedQuery(target.sql, ctx)

    if (!result.ok) {
      errors.push(`Query failed: ${target.sql} — ${result.error}`)
      continue
    }

    if (result.value.length === 0) {
      errors.push(`Query resolved to no results: ${target.sql}`)
      continue
    }

    const resolved = resolveQueryHits(result.value, getFileView)
    const merged = mergeOverlappingRanges(resolved)

    console.debug(
      `[plan-deep] query resolved ${result.value.length} hits → ${merged.length} sections`
    )

    queryHits.push(...merged)
  }

  return { files, queryHits, errors }
}

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

const labelComposites = async (
  path: string,
  composites: Composite[],
  lineMap: number[]
): Promise<LabeledTarget[]> => {
  const indexed = composites.map((composite, index) => ({ index, composite }))

  const { results, failures } = await processPool(
    indexed,
    async ({ index, composite }) => {
      const presented = presentContent(composite.content)
      const label = await labelSection(presented)
      const rawRanges = composite.segments.map((s) => ({
        startLine: s.startLine,
        endLine: s.endLine,
      }))
      const ranges = remapRanges(lineMap, rawRanges)
      const target: LabeledTarget = { path, label: label.label, desc: label.desc, ranges }
      return [{ index, target }]
    },
    () => undefined,
    { concurrency: 10, warmup: 1 }
  )

  if (failures.length > 0) {
    const details = failures.map((f) => errorMessage(f.error)).join("; ")
    throw new Error(`labeling failed for ${path}: ${failures.length} chunk(s): ${details}`)
  }

  return (results as { index: number; target: LabeledTarget }[])
    .sort((a, b) => a.index - b.index)
    .map((r) => r.target)
}

const filterAndLabelTarget = async (
  path: string,
  content: string,
  framework: string
): Promise<LabeledTarget[]> => {
  const { content: stripped, lineMap } = stripCodeBlockLines(content)
  const { surviving } = await filterTarget(framework, stripped)

  if (surviving.length === 0) return []

  const chunks = chunkLines(stripped, CHUNK_TARGET_CHARS)
  const segments = mergeAndChunk(surviving, path, CHUNK_TARGET_CHARS, chunks)

  const sorted = sortSegments(segments)
  const composites = packComposites(sorted, CHUNK_TARGET_CHARS, paragraphSeparator)

  return labelComposites(path, composites, lineMap)
}

const labelQueryTargets = async (sections: ResolvedSection[]): Promise<LabeledTarget[]> => {
  if (sections.length === 0) return []

  const byFile = new Map<string, ResolvedSection[]>()
  for (const s of sections) {
    const group = byFile.get(s.path)
    if (group) group.push(s)
    else byFile.set(s.path, [s])
  }

  const allLabeled: LabeledTarget[] = []

  for (const [path, fileSections] of byFile) {
    const content = getFileView(path)
    if (content === undefined) continue

    const { content: stripped, lineMap } = stripCodeBlockLines(content)
    const lines = stripped.split("\n")

    const segments = fileSections.map((s) => ({
      path,
      startLine: s.startLine,
      endLine: s.endLine,
      content: lines.slice(s.startLine - 1, s.endLine).join("\n"),
    }))

    const sorted = sortSegments(segments)
    const composites = packComposites(sorted, CHUNK_TARGET_CHARS, paragraphSeparator)
    const labeled = await labelComposites(path, composites, lineMap)
    allLabeled.push(...labeled)
  }

  return allLabeled
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
      const {
        files: resolvedTargets,
        queryHits,
        errors: queryErrors,
      } = await resolveQueryTargets(target_files)
      if (queryErrors.length > 0)
        return { status: "error", output: queryErrors.join("\n"), mutations: [] }

      const missingSources = findMissingFiles(source_files)
      if (missingSources.length > 0)
        return {
          status: "error",
          output: `Files not found: ${missingSources.join(", ")}`,
          mutations: [],
        }

      if (post_action === "annotate_as_code") {
        const frameworkPaths = source_files
          .filter((f) => f.group === "framework")
          .map((f) => f.path)
        const mismatch = validateFrameworkNoCallouts(frameworkPaths, getFileView)
        if (mismatch) return { status: "error", output: mismatch, mutations: [] }
      }

      pushSourceBlocks(source_files)
      const framework = buildFramework(source_files)

      let fileLabeled: LabeledTarget[]
      try {
        fileLabeled = await filterAndLabelTargets(resolvedTargets, framework)
      } catch (e) {
        return { status: "error", output: errorMessage(e), mutations: [] }
      }

      let queryLabeled: LabeledTarget[]
      try {
        queryLabeled = await labelQueryTargets(queryHits)
      } catch (e) {
        return { status: "error", output: errorMessage(e), mutations: [] }
      }

      const labeled = [...fileLabeled, ...queryLabeled]

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
