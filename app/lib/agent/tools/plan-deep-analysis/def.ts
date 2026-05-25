import { z } from "zod"
import type { AnyTool } from "../../executors/tool"
import { FileEntry, TOO_MANY_FILES_NUDGE } from "../file-entry"
import { PostAction } from "../apply-deep-analysis/def"

const SourceFileEntry = FileEntry.extend({
  group: z
    .enum(["framework", "dimension"])
    .describe(
      "framework = general rules applied to every evaluation. dimension = discrete angle evaluated on its own."
    ),
})

export type SourceFileEntry = z.infer<typeof SourceFileEntry>

const FileTarget = z.object({
  type: z.literal("file"),
  path: z.string().describe("File path"),
  group: z.string().describe('UI grouping label (e.g. "Transcript", "Codebook")'),
})

const QueryTarget = z.object({
  type: z.literal("query"),
  sql: z.string().min(1).describe("SQL query to find target files via search"),
})

export const TargetEntry = z.discriminatedUnion("type", [FileTarget, QueryTarget])

export type TargetEntry = z.infer<typeof TargetEntry>

export const PlanDeepAnalysisArgs = z.object({
  target_files: z
    .array(z.union([FileEntry, TargetEntry]))
    .max(5, TOO_MANY_FILES_NUDGE)
    .describe(
      "Files or queries to analyze — content that will be examined against the source criteria. Each is either a file path with group label, or a SQL query (`type: 'query'`) that resolves to files."
    ),
  source_files: z
    .array(SourceFileEntry)
    .max(40, TOO_MANY_FILES_NUDGE)
    .describe("Files containing analysis definitions, frameworks, or criteria to apply."),
  post_action: PostAction.describe(
    "How apply_deep_analysis handles results: return (results only), annotate_as_code (write code annotations), annotate_as_comment (write comment annotations)."
  ),
  interactive: z
    .boolean()
    .describe(
      "Pause for user feedback after each analysis section. Set false if user preferences are established. If unknown, ask before calling."
    ),
})

export type PlanDeepAnalysisArgs = z.infer<typeof PlanDeepAnalysisArgs>

export const planDeepAnalysisTool: AnyTool = {
  name: "plan_deep_analysis",
  description:
    "Load source criteria and target files, filter target sections by relevance. Auto generates and starts a structured plan to follow. Use when applying analytical criteria from source files across target content.\n\nparallel: no — batches internally, wait for results before acting",
  schema: PlanDeepAnalysisArgs,
}
