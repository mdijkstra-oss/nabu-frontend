import { z } from "zod"
import type { AnyTool } from "../../executors/tool"

export const PostAction = z.enum(["return", "annotate_as_code", "annotate_as_comment"])

export type PostAction = z.infer<typeof PostAction>

export const SourceFile = z.object({
  path: z.string().describe("File path"),
  scope: z.enum(["framework", "dimension"]),
})

export type SourceFile = z.infer<typeof SourceFile>

export const Target = z
  .object({
    path: z.string().describe("File path"),
    start_line: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "First line of the target (1-based). Omit with end_line to analyze the whole file."
      ),
    end_line: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Last line of the target (1-based). Omit with start_line to analyze the whole file."
      ),
  })
  .refine(
    (t) => (t.start_line === undefined) === (t.end_line === undefined),
    "start_line and end_line must both be provided or both omitted"
  )

export type Target = z.infer<typeof Target>

export const ApplyDeepAnalysisArgs = z
  .object({
    targets: z
      .array(Target)
      .optional()
      .describe(
        "Targets to analyze. Each is a file path with optional line range. Omit line numbers to analyze the whole file. Use this OR search_id, not both."
      ),
    search_id: z
      .string()
      .optional()
      .describe(
        "ID of a saved search whose hit chunks become the targets to analyze. Use this when coding search results — do not also pass targets. Hits are resolved to file paths and line ranges automatically."
      ),
    source_files: z
      .array(SourceFile)
      .min(1)
      .describe(
        "Files with criteria to apply. `framework` = general rules/protocol applied as common context to every evaluation. `dimension` = discrete angle of the framework, evaluated on its own. Mark as `framework` anything that applies across dimensions; mark as `dimension` only the actual items being judged. Misclassifying framework rules as dimensions causes redundant evaluations without improving quality."
      ),
    post_action: PostAction.describe(
      "return: get results only. annotate_as_code: clears existing annotations for the dimension's code IDs within the analyzed targets, then writes fresh code annotations from the analysis results. annotate_as_comment: writes comment annotations without clearing existing ones."
    ),
    synthesize: z
      .boolean()
      .optional()
      .describe(
        "When true, the tool output ends with a Synthesis directive describing how to write the synthesis for the chat response. Use for whole-file coding passes; leave unset for selection or search coding."
      ),
  })
  .refine(
    (a) => (a.targets?.length ?? 0) > 0 || a.search_id !== undefined,
    "Provide either targets or search_id"
  )

export type ApplyDeepAnalysisArgs = z.infer<typeof ApplyDeepAnalysisArgs>

export const FILTER_ENDPOINT = "/deep-analysis-filter"
export const ADJUDICATE_ENDPOINT = "/deep-analysis-adjudicate"
// One route suffix per voter. The gateway resolves a model from the path, so a
// voter that is not a suffix here is not a voter.
export const FILTER_VOTERS = ["openai", "anthropic"] as const
export const FILTER_RUNS = FILTER_VOTERS.length
export const ADJUDICATE_RUNS = 1
export const SPAN_STEP_CONTEXT_SENTENCES = 6
export const BRANCH_CONCURRENCY = 10
export const PER_DIM_TARGET = 50
export const POST_FIND_CONCURRENCY = 5

export const applyDeepAnalysisTool: AnyTool = {
  name: "apply_deep_analysis",
  description:
    "Run deep analysis on file targets against source criteria. Accepts multiple targets — all run in parallel internally. Returns structured results or writes annotations depending on post_action.\n\nparallel: no — batches internally, one call handles all targets",
  schema: ApplyDeepAnalysisArgs,
}
