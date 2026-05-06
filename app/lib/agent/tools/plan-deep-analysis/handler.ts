import type { Block } from "../../client/blocks"
import type { HandlerResult } from "../../types"
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
const toSystemBlock = (content: string): Block => ({ type: "system", content })

const READ_MARKER = "## READ MEMORY"
const RECENCY_THRESHOLD = 15

type ScoutResult = { ok: true; path: string; entry: ScoutEntry } | { ok: false; path: string }

const tryScout = async (file: FileEntry, forceScout: boolean): Promise<ScoutResult> => {
  try {
    const content = getFileView(file.path)
    if (content === undefined) return { ok: false, path: file.path }
    const entry = await scoutFile(file.path, content, { forceScout })
    return { ok: true, path: file.path, entry }
  } catch {
    return { ok: false, path: file.path }
  }
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

      const sourceFailed: string[] = []

      const { failures: sourceFailures } = await processPool(
        source_files,
        async (f) => {
          const result = await tryScout(f, false)
          if (!result.ok) {
            sourceFailed.push(result.path)
            return []
          }
          return [toSystemBlock(formatScoutEntry(result.entry))]
        },
        (blocks) => pushBlocks(blocks),
        { concurrency: 3 }
      )

      for (const f of sourceFailures) sourceFailed.push(f.item.path)

      if (sourceFailed.length === source_files.length)
        return {
          status: "error",
          output: `All source files failed: ${sourceFailed.join(", ")}`,
          mutations: [],
        }

      const targetEntries: { path: string; entry: ScoutEntry }[] = []
      const targetFailed: string[] = []

      const { failures: targetFailures } = await processPool(
        target_files,
        async (f) => {
          const result = await tryScout(f, true)
          if (!result.ok) {
            targetFailed.push(result.path)
            return []
          }
          targetEntries.push({ path: result.path, entry: result.entry })
          return []
        },
        () => undefined,
        { concurrency: 3 }
      )

      for (const f of targetFailures) targetFailed.push(f.item.path)

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

      const total = target_files.length + source_files.length
      const failed = [...sourceFailed, ...targetFailed]

      if (failed.length === 0) return { status: "ok", output: "ok", directive, mutations: [] }
      if (failed.length === total)
        return { status: "error", output: `All files failed: ${failed.join(", ")}`, mutations: [] }

      return {
        status: "partial",
        output: "ok",
        directive,
        message: `${total - failed.length}/${total} files processed. Failed: ${failed.join(", ")}`,
        mutations: [],
      } as HandlerResult<string>
    },
  })
)
