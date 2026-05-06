import { afterToolResult, systemNudge, type Nudger } from "../nudge-tools"
import type { FileStore } from "~/lib/files/store"
import { derive, lastPlan, hasActivePlan, actionsSinceStepChange } from "../../derived"
import { formatStepProgress } from "./step-state"

const STUCK_THRESHOLD = 12
const MARKER = "[plan-stuck]"

export const createPlanProgressNudge =
  (getFiles: () => FileStore): Nudger =>
  (history) => {
    if (!afterToolResult(history)) return null

    const d = derive(history, getFiles())
    if (!hasActivePlan(d.plans)) return null

    const plan = lastPlan(d.plans)
    if (!plan || plan.currentStep === null) return null

    const actions = actionsSinceStepChange(history)
    if (actions < STUCK_THRESHOLD) return null

    const step = plan.steps[plan.currentStep]
    return systemNudge(
      [
        MARKER,
        `You have been on step "${step.description}" for ${actions} actions without completing it.`,
        "",
        formatStepProgress(plan),
      ].join("\n")
    )
  }
