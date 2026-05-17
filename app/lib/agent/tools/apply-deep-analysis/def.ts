import { z } from "zod"
import type { AnyTool } from "../../executors/tool"

export const PostAction = z.enum(["return", "annotate_as_code", "annotate_as_comment"])

export type PostAction = z.infer<typeof PostAction>

export const SourceFile = z.object({
  path: z.string().describe("File path"),
  scope: z.enum(["framework", "dimension"]),
})

export type SourceFile = z.infer<typeof SourceFile>

export const Section = z.object({
  path: z.string().describe("File path"),
  start_line: z
    .number()
    .int()
    .min(1)
    .describe("First line of the section (1-based, from scout map)"),
  end_line: z.number().int().min(1).describe("Last line of the section (1-based, from scout map)"),
})

export type Section = z.infer<typeof Section>

export const ApplyDeepAnalysisArgs = z.object({
  sections: z
    .array(Section)
    .min(1)
    .describe("Sections to analyze. Each section is a range within a file."),
  source_files: z
    .array(SourceFile)
    .min(1)
    .describe(
      "Files with criteria to apply. `framework` = general rules/protocol applied as common context to every evaluation. `dimension` = discrete angle of the framework, evaluated on its own. Mark as `framework` anything that applies across dimensions; mark as `dimension` only the actual items being judged. Misclassifying framework rules as dimensions causes redundant evaluations without improving quality."
    ),
  post_action: PostAction.describe(
    "return: get results. annotate_as_code: write code annotations (analysis_source_id = code id). annotate_as_comment: write comment annotations."
  ),
})

export type ApplyDeepAnalysisArgs = z.infer<typeof ApplyDeepAnalysisArgs>

export const FIND_ENDPOINT = "/deep-analysis-find"
export const REASON_ENDPOINT = "/deep-analysis-reason"
export const FILTER_ENDPOINT = "/deep-analysis-filter"
export const ADJUDICATE_ENDPOINT = "/deep-analysis-adjudicate"
export const TRIM_ENDPOINT = "/deep-analysis-trim"
// Splits even uneven to ?model=1 or model=0 for model diversification
export const FIND_RUNS = 2
export const FIND_THRESHOLD = 1
export const FILTER_RUNS = 2
export const FILTER_THRESHOLD = 2
export const SPAN_STEP_CONTEXT_SENTENCES = 6
export const POST_FIND_CONCURRENCY = 5

export const applyDeepAnalysisTool: AnyTool = {
  name: "apply_deep_analysis",
  description:
    "Run deep analysis on file sections against source criteria. Accepts multiple sections — all run in parallel internally. Returns structured results or writes annotations depending on post_action.\n\nparallel: no — batches internally, one call handles all sections",
  schema: ApplyDeepAnalysisArgs,
}
