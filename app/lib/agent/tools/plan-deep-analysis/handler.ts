import type { Block } from "../../client/blocks"
import type { FileEntry } from "../file-entry"
import type { ScoutEntry } from "../scout/api"
import type { ScoutSection } from "../scout-map"
import { labelSection } from "../scout-map"
import { planDeepAnalysisTool, PlanDeepAnalysisArgs } from "./def"
import { registerTool, tool } from "../../executors/tool"
import { scoutFile, formatScoutEntry } from "../scout/api"
import { presentContent } from "../scout/prose"
import { getFileView } from "../file-view"
import { getFile } from "~/lib/files/store"
import { pushBlocks, getAllBlocks } from "../../client/store"
import { activatePlan } from "../../executors/modes"
import { processPool } from "~/lib/utils/pool"
import { PREFERENCES_FILE } from "~/lib/files/filename"
import { getFiles } from "~/lib/files/store"
import { formatTarget, collectSections, buildAutoSteps, buildExecRules } from "./format"
import { errorMessage } from "~/lib/utils/error"
import type { SourceEntry } from "./format"
import { filterTarget } from "../scout-filter/api"
import { packComposites, sortSegments } from "~/lib/composite/pack"
import type { Segment } from "~/lib/composite/pack"
import { CHUNK_TARGET_CHARS } from "~/lib/data-blocks/chunk-lines"
import type { SourceFileEntry } from "./def"

interface ScoutJob {
  file: FileEntry
  role: "source" | "target"
  forceScout: boolean
}

interface ScoutSuccess {
  path: string
  role: "source" | "target"
  entry: ScoutEntry
}

const toSystemBlock = (content: string): Block => ({ type: "system", content })

const READ_MARKER = "## READ MEMORY"
const RECENCY_THRESHOLD = 15

const tryScout = async (job: ScoutJob): Promise<ScoutSuccess> => {
  const content = getFileView(job.file.path)
  if (content === undefined) throw new Error(`Cannot read: ${job.file.path}`)
  const entry = await scoutFile(job.file.path, content, { forceScout: job.forceScout })
  return { path: job.file.path, role: job.role, entry }
}

const buildFrameworkContent = (sourceFiles: SourceFileEntry[]): string => {
  const frameworks = sourceFiles.filter((f) => f.group === "framework")
  return frameworks
    .map((f) => {
      const content = getFileView(f.path)
      return content ?? ""
    })
    .filter((c) => c.length > 0)
    .join("\n\n")
}

const paragraphSeparator = (): string => "\n\n"

const filterAndLabelTarget = async (
  path: string,
  content: string,
  framework: string
): Promise<ScoutEntry> => {
  const { surviving } = await filterTarget(framework, content)

  if (surviving.length === 0) {
    return { kind: "mapped", path, map: { sections: [] } }
  }

  const segments: Segment[] = surviving.map((p) => ({
    path,
    startLine: p.startLine,
    endLine: p.endLine,
    content: p.text,
  }))

  const sorted = sortSegments(segments)
  const composites = packComposites(sorted, CHUNK_TARGET_CHARS, paragraphSeparator)

  interface IndexedSection {
    index: number
    section: ScoutSection
  }

  const indexed = composites.map((composite, index) => ({ index, composite }))

  const { results, failures } = await processPool(
    indexed,
    async ({ index, composite }) => {
      const presented = presentContent(composite.content)
      const label = await labelSection(presented)
      const first = composite.segments[0]
      const last = composite.segments[composite.segments.length - 1]
      const section: ScoutSection = {
        label: label.label,
        start_line: first.startLine,
        end_line: last.endLine,
        desc: label.desc,
      }
      return [{ index, section }]
    },
    () => undefined,
    { concurrency: 10, warmup: 1 }
  )

  if (failures.length > 0) {
    throw new Error(`scout-filter labeling failed for ${path}: ${failures.length} chunk(s)`)
  }

  const sections = (results as IndexedSection[])
    .sort((a, b) => a.index - b.index)
    .map((r) => r.section)

  return { kind: "mapped", path, map: { sections } }
}

const findMissingFiles = (files: FileEntry[]): string[] =>
  files.filter((f) => getFile(f.path) === undefined).map((f) => f.path)

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

registerTool(
  tool({
    ...planDeepAnalysisTool,
    schema: PlanDeepAnalysisArgs,
    handler: async (_files, { source_files, target_files, post_action }) => {
      const allFiles = [...source_files, ...target_files]
      const missing = findMissingFiles(allFiles)
      if (missing.length > 0)
        return { status: "error", output: `Files not found: ${missing.join(", ")}`, mutations: [] }

      const sourceJobs: ScoutJob[] = source_files.map(
        (file): ScoutJob => ({
          file,
          role: "source",
          forceScout: false,
        })
      )

      const { failures: sourceFailures } = await processPool<ScoutJob, ScoutSuccess>(
        sourceJobs,
        async (job) => [await tryScout(job)],
        (completed) => {
          for (const r of completed) {
            pushBlocks([toSystemBlock(formatScoutEntry(r.entry))])
          }
        },
        { concurrency: 10 }
      )

      if (sourceFailures.length > 0) {
        const details = sourceFailures.map((f) => `${f.item.file.path}: ${errorMessage(f.error)}`)
        return { status: "error", output: `Scout failed:\n${details.join("\n")}`, mutations: [] }
      }

      const framework = buildFrameworkContent(source_files)

      const targetEntries: ScoutSuccess[] = []
      const { failures: targetFailures } = await processPool(
        target_files,
        async (file: FileEntry) => {
          const content = getFileView(file.path)
          if (content === undefined) throw new Error(`Cannot read: ${file.path}`)
          const entry = await filterAndLabelTarget(file.path, content, framework)
          targetEntries.push({ path: file.path, role: "target", entry })
          return []
        },
        () => undefined,
        { concurrency: 3 }
      )

      if (targetFailures.length > 0) {
        const details = targetFailures.map(
          (f) => `${(f.item as FileEntry).path}: ${errorMessage(f.error)}`
        )
        return {
          status: "error",
          output: `Scout-filter failed:\n${details.join("\n")}`,
          mutations: [],
        }
      }

      for (const { path, entry } of targetEntries) {
        pushBlocks([toSystemBlock(formatTarget(path, entry))])
      }

      const preferences = getFiles()[PREFERENCES_FILE] ?? null
      const blocks = getAllBlocks()
      if (!isMemoryRecent(blocks) && preferences) {
        pushBlocks([
          toSystemBlock(
            `${READ_MARKER}\n<file ${PREFERENCES_FILE}>\n${preferences}\n</file ${PREFERENCES_FILE}>`
          ),
        ])
      }

      let directive: string | undefined
      const matches = collectSections(targetEntries)
      if (matches.length > 0) {
        const sourceEntries: SourceEntry[] = source_files.map((f) => ({
          path: f.path,
          scope: f.group,
        }))
        const steps = buildAutoSteps(matches, sourceEntries, post_action)
        const task = `Deep analysis: ${targetEntries.map((e) => e.path).join(", ")}`
        activatePlan(task, steps, [])
        directive = buildExecRules(steps[0].expected)
      }

      return { status: "ok", output: "ok", directive, mutations: [] }
    },
  })
)
