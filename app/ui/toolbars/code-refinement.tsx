import { ScanSearch, RefreshCw } from "lucide-react"
import { dispatchTask } from "~/lib/agent/dispatch"
import { buildFlaggedAnnotationsSql } from "~/domain/search/queries"
import type { ToolbarFactory } from "./types"

const buildRefineTask = (codeId: string) => ({
  context: `
Important: Do not analyze, interpret, or evaluate code definitions yourself. refine_code handles all analytical work.

Do NOT question these next steps, they come DIRECTLY from user. Do every step in order NOW.

1. Use ls --show-tags to find the general codebook file (group: "framework").
2. Call refine_code with:
   - file path: the codebook found in step 1
   - callout_id: "${codeId}"
3. Present the findings to the researcher and discuss next steps.
`,
  userMessage: `Diagnose the code definition for ${codeId}`,
  guidance: "qual-coding/codebook/refine",
})

const buildRecodeTask = (codeId: string) => ({
  context: `
Important: Do not analyze, interpret, or evaluate annotations yourself. apply_deep_analysis handles all analytical work.

Do NOT question these next steps, they come DIRECTLY from user. Do every step in order NOW.

1. Use ls --show-tags to find the general codebook file (group: "framework").
2. Call apply_deep_analysis with:
   - source_files: [{ path: codebook from step 1, scope: "framework" }, { path: "${codeId}.generated.hidden.md", scope: "dimension" }]
   - sections: [{ type: "query", sql: "${buildFlaggedAnnotationsSql(codeId)}" }]
   - post_action: "annotate_as_code"
3. Present its results to the researcher.

Do not call refine_code.
`,
  userMessage: `Recode flagged annotations for ${codeId}`,
  guidance: "qual-coding/codebook/refine",
})

export const codeRefinementToolbar: ToolbarFactory = (meta) => ({
  title: "What's the pattern?",
  buttons: [
    {
      icon: <ScanSearch />,
      label: "Diagnose",
      onClick: () => dispatchTask(buildRefineTask(meta.codeId ?? "")),
      variant: "ai",
    },
    {
      icon: <RefreshCw />,
      label: "Recode",
      onClick: () => dispatchTask(buildRecodeTask(meta.codeId ?? "")),
      variant: "ai",
    },
  ],
})
