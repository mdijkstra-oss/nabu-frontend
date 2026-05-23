import { afterToolResult, isLastToolResult, systemNudge, type Nudger } from "../nudge-tools"
import type { FileStore } from "~/lib/files/store"
import { derive, lastPlan, hasActivePlan } from "../../derived"
import { formatStepProgress } from "./step-state"

const AFTER_ASK_DIRECTIVE = "User responded. Call complete_step now to proceed."

export const createStepAfterAskNudge =
  (getFiles: () => FileStore): Nudger =>
  (history) => {
    if (!afterToolResult(history)) return null
    if (!isLastToolResult(history, "ask")) return null

    const d = derive(history, getFiles())
    if (!hasActivePlan(d.plans)) return null

    const plan = lastPlan(d.plans)
    if (!plan || plan.currentStep === null) return null

    const progress = formatStepProgress(plan)
    return systemNudge([AFTER_ASK_DIRECTIVE, "", progress].join("\n"))
  }
