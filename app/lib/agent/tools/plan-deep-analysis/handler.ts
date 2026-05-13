import type { Block } from "../../client/blocks"
import type { FileEntry } from "../file-entry"
import type { ScoutEntry } from "../scout/api"
import { planDeepAnalysisTool, PlanDeepAnalysisArgs } from "./def"
import { registerTool, tool } from "../../executors/tool"
import { scoutFile, formatScoutEntry } from "../scout/api"
import { getFileView } from "../file-view"
import { getFile } from "~/lib/files/store"
import { pushBlocks, getAllBlocks } from "../../client/store"
import { activatePlan } from "../../executors/modes"
import { processPool } from "~/lib/utils/pool"
import { PREFERENCES_FILE } from "~/lib/files/filename"
import { getFiles } from "~/lib/files/store"
import { formatTarget, collectSections, buildAutoSteps, buildExecRules } from "./format"
import type { SourceEntry } from "./format"

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

      const jobs: ScoutJob[] = [
        ...source_files.map((file): ScoutJob => ({ file, role: "source", forceScout: false })),
        ...target_files.map((file): ScoutJob => ({ file, role: "target", forceScout: true })),
      ]

      const { results, failures } = await processPool<ScoutJob, ScoutSuccess>(
        jobs,
        async (job) => [await tryScout(job)],
        (completed) => {
          for (const r of completed) {
            if (r.role === "source") pushBlocks([toSystemBlock(formatScoutEntry(r.entry))])
          }
        },
        { concurrency: 10 }
      )

      if (failures.length > 0) {
        const failedPaths = failures.map((f) => f.item.file.path)
        return { status: "error", output: `Scout failed: ${failedPaths.join(", ")}`, mutations: [] }
      }

      const targetEntries = results.filter((r) => r.role === "target")

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
