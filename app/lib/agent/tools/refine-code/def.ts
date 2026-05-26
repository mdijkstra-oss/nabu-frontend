import { z } from "zod"
import type { AnyTool } from "../../executors/tool"

export const RefineCodeArgs = z.object({
  callout_id: z.string().describe("ID of the code to refine"),
  guidance: z
    .string()
    .optional()
    .describe("Specific instructions for the analysis (e.g. focus areas, what to avoid)"),
  general_codebook_file: z
    .string()
    .optional()
    .describe("Path to the general codebook rules file (framework-level guidance)"),
})

export type RefineCodeArgs = z.infer<typeof RefineCodeArgs>

export const REFINE_CODE_ENDPOINT = "/refine-code"
export const ANNOTATION_SAMPLE_SIZE = 20

export const refineCodeTool: AnyTool = {
  name: "refine_code",
  description:
    "Analyze a code definition for structural and internal consistency, optionally against reviewed codings. Sends the code definition, sibling codes, and any reviewed annotations to a dedicated analysis agent. Include guidance to steer the analysis and a general codebook for framework-level context.\n\nparallel: no",
  schema: RefineCodeArgs,
}
