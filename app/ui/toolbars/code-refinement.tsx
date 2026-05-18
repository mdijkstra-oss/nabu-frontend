import { Sparkles } from "lucide-react"
import { dispatchTask } from "~/lib/agent/dispatch"
import type { ToolbarFactory } from "./types"

const buildRefineTask = (codeId: string) => ({
  context: `Use ls --show-tags to find the general codebook file, then call refine_code with that file path and callout_id "${codeId}". Present the findings to the researcher and discuss next steps.`,
  userMessage: `Diagnose the code definition for ${codeId}`,
  guidance: "qual-coding/codebook/refine",
})

export const codeRefinementToolbar: ToolbarFactory = (meta) => ({
  title: "What's the pattern?",
  buttons: [
    {
      icon: <Sparkles />,
      label: "Diagnose",
      onClick: () => dispatchTask(buildRefineTask(meta.codeId ?? "")),
      variant: "ai",
    },
  ],
})
