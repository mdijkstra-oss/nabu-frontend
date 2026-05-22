import { afterToolResult, isLastToolResult, systemNudge, type Nudger } from "../nudge-tools"
import type { FileStore } from "~/lib/files/store"
import { derive, lastPlan, hasActivePlan } from "../../derived"
import { formatDirective, formatStepProgress } from "./step-state"

export const createStepAfterAskNudge =
  (getFiles: () => FileStore): Nudger =>
  (history) => {
    if (!afterToolResult(history)) return null
    if (!isLastToolResult(history, "ask")) return null

    const d = derive(history, getFiles())
    if (!hasActivePlan(d.plans)) return null

    const plan = lastPlan(d.plans)
    if (!plan || plan.currentStep === null) return null

    const directive = formatDirective(plan, plan.currentStep)
    const progress = formatStepProgress(plan)
    return systemNudge([directive, "", progress].join("\n"))
  }
