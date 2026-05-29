import type { FileEntry } from "../file-entry"
import { planDeepAnalysisTool, PlanDeepAnalysisArgs } from "./def"
import { registerTool, tool } from "../../executors/tool"
import { showProgress } from "../../client/store"
import { activatePlan } from "../../executors/modes"
import { buildAutoSteps, buildExecRules, toSectionMatches } from "./format"
import type { LabeledTarget, SourceEntry } from "./format"
import { errorMessage } from "~/lib/utils/error"
import { resolveSearchTargets } from "./resolve"
import { filterFileTargets, filterSearchTargets } from "./filter"
import { labelAll } from "./label"
import {
  findMissingFiles,
  buildFramework,
  validateAnnotationSources,
  pushSourceBlocks,
  pushTargetBlocks,
  injectMemory,
} from "./context"

const isSearchFile = (f: FileEntry): boolean => f.group === "Search"

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
      const { files: resolvedTargets, searchIds, errors } = await resolveSearchTargets(target_files)
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

      let labeled: LabeledTarget[]
      try {
        showProgress("Preselecting sections…")
        const fileItems = await filterFileTargets(explicitFiles, framework)
        const searchItems = await filterSearchTargets(searchFiles, framework)
        showProgress("Labeling sections…")
        labeled = await labelAll([...fileItems, ...searchItems])
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
