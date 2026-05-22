import { afterToolResult, alreadyFired, systemNudge, type Nudger } from "../nudge-tools"
import type { FileStore } from "~/lib/files/store"
import type { DerivedPlan, Step } from "../../derived"
import { derive, lastPlan, hasActivePlan } from "../../derived"

const formatStepLine = (step: Step, isCurrent: boolean): string => {
  const tag = step.done ? "[done]" : isCurrent ? "[now ]" : "[    ]"
  return `${tag} ${step.description}`
}

export const formatStepProgress = (plan: DerivedPlan): string =>
  plan.steps.map((step, i) => formatStepLine(step, i === plan.currentStep)).join("\n")

export const formatDirective = (plan: DerivedPlan, stepIndex: number): string => {
  const step = plan.steps[stepIndex]
  return `Current step (${stepIndex + 1}): "${step.description}" — call complete-step when done.\n\n${step.expected}`
}

const stepMarker = (stepIndex: number): string => `[step:${stepIndex + 1}]`

export const createStepStateNudge =
  (getFiles: () => FileStore): Nudger =>
  (history) => {
    if (!afterToolResult(history)) return null

    const d = derive(history, getFiles())
    if (!hasActivePlan(d.plans)) return null

    const plan = lastPlan(d.plans)
    if (!plan || plan.currentStep === null) return null

    const marker = stepMarker(plan.currentStep)
    if (alreadyFired(history, marker)) return null

    const directive = formatDirective(plan, plan.currentStep)
    const progress = formatStepProgress(plan)
    return systemNudge([marker, directive, "", progress].join("\n"))
  }
