import type { FileEntry } from "../file-entry"
import { planDeepAnalysisTool, PlanDeepAnalysisArgs } from "./def"
import { registerTool, tool } from "../../executors/tool"
import { showProgress } from "../../client/store"
import { activatePlan } from "../../executors/modes"
import { buildAutoSteps, buildExecRules, toSectionMatches, groupSearchSections } from "./format"
import type { LabeledTarget, SourceEntry, SectionEntry, FileSearchGroup } from "./format"
import { errorMessage } from "~/lib/utils/error"
import { resolveSearchTargets } from "./resolve"
import type { FileHitGroup } from "./resolve"
import { filterFileTargets } from "./filter"
import { labelAll } from "./label"
import { getFileView } from "../file-view"
import {
  findMissingFiles,
  buildFramework,
  validateAnnotationSources,
  pushSourceBlocks,
  pushTargetBlocks,
  injectMemory,
} from "./context"

const isSearchFile = (f: FileEntry): boolean => f.group === "Search"

const lineAtChar = (content: string, charIndex: number): number => {
  let line = 1
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === "\n") line++
  }
  return line
}

const locateHitSections = (content: string, path: string, hitTexts: string[]): SectionEntry[] =>
  hitTexts.flatMap((text) => {
    const idx = content.indexOf(text)
    if (idx === -1) return []
    const startLine = lineAtChar(content, idx)
    const endLine = lineAtChar(content, idx + text.length)
    return [{ path, startLine, endLine }]
  })

const toSearchGroups = (files: FileEntry[], hits: Map<string, FileHitGroup>): FileSearchGroup[] =>
  files.flatMap((f) => {
    const content = getFileView(f.path)
    if (content === undefined) return []
    const group = hits.get(f.path)
    if (!group) return []
    const sections = locateHitSections(content, f.path, group.texts)
    if (sections.length === 0) return []
    const totalChars = group.texts.reduce((sum, t) => sum + t.length, 0)
    return [
      {
        path: f.path,
        sections,
        totalChars,
        resultCount: group.texts.length,
        bestScore: group.bestScore,
      },
    ]
  })

const buildTaskDescription = (searchIds: string[], labeled: LabeledTarget[]): string => {
  const searchRefs = searchIds.map((id) => `file://${id}`)
  const desc =
    searchRefs.length > 0
      ? searchRefs.join(", ")
      : [...new Set(labeled.map((t) => t.path))].join(", ")
  return `Deep analysis: ${desc}`
}

registerTool(
  tool({
    ...planDeepAnalysisTool,
    schema: PlanDeepAnalysisArgs,
    handler: async (_files, { source_files, target_files, post_action, interactive }) => {
      showProgress("Searching corpus…")
      const {
        files: resolvedTargets,
        searchIds,
        searchHits,
        errors,
      } = await resolveSearchTargets(target_files)
      if (errors.length > 0) return { status: "error", output: errors.join("\n"), mutations: [] }

      const missing = findMissingFiles(source_files)
      if (missing.length > 0)
        return { status: "error", output: `Files not found: ${missing.join(", ")}`, mutations: [] }

      if (post_action === "annotate_as_code") {
        const mismatch = validateAnnotationSources(source_files)
        if (mismatch) return { status: "error", output: mismatch, mutations: [] }
      }

      pushSourceBlocks(source_files)
      const framework = buildFramework(source_files)

      const explicitFiles = resolvedTargets.filter((f) => !isSearchFile(f))
      const searchFiles = resolvedTargets.filter(isSearchFile)
      console.debug(
        `[plan-search] targets: ${explicitFiles.length} explicit, ${searchFiles.length} search files`
      )

      let labeled: LabeledTarget[]
      try {
        showProgress("Preselecting sections…")
        const fileItems = await filterFileTargets(explicitFiles, framework)
        console.debug(`[plan-search] filter done: ${fileItems.length} file items → labeling`)
        showProgress("Labeling sections…")
        labeled = await labelAll(fileItems)
      } catch (e) {
        return { status: "error", output: errorMessage(e), mutations: [] }
      }

      pushTargetBlocks(labeled)
      injectMemory()

      const fileMatches = toSectionMatches(labeled)

      const searchGroups = toSearchGroups(searchFiles, searchHits)
      const searchMatches = groupSearchSections(searchGroups)
      console.debug(
        `[plan-search] search grouping: ${searchGroups.length} files → ${searchMatches.length} steps`
      )

      const allMatches = [...fileMatches, ...searchMatches]
      if (allMatches.length === 0) return { status: "ok", output: "ok", mutations: [] }

      const sourceEntries: SourceEntry[] = source_files.map((f) => ({
        path: f.path,
        scope: f.group,
      }))
      const steps = buildAutoSteps(allMatches, sourceEntries, post_action, interactive)
      activatePlan(buildTaskDescription(searchIds, labeled), steps, [])

      return {
        status: "ok",
        output: "ok",
        directive: buildExecRules(steps[0].expected),
        mutations: [],
      }
    },
  })
)
