import { ScanSearch, RefreshCw } from "lucide-react"
import { dispatchTask } from "~/lib/agent/dispatch"
import { buildFlaggedAnnotationsSql } from "~/domain/search/queries"
import type { ToolbarFactory } from "./types"

const buildRefineTask = (codeId: string) => ({
  context: `Use ls --show-tags to find the general codebook file, then call refine_code with that file path and callout_id "${codeId}". Present the findings to the researcher and discuss next steps.`,
  userMessage: `Diagnose the code definition for ${codeId}`,
  guidance: "qual-coding/codebook/refine",
})

const buildRecodeTask = (codeId: string) => ({
  context: `Use ls --show-tags to find the general codebook file, then call apply_deep_analysis with source_files pointing to that codebook (group: "framework") and sections: [{ type: "query", sql: "${buildFlaggedAnnotationsSql(codeId)}" }]. Use post_action: "annotate_as_code". Present the results to the researcher.`,
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
