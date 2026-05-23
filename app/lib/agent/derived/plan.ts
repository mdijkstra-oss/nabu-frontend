export interface StepDefObject {
  title: string
  expected: string
  checkpoint?: boolean
}
export interface StepDefNested {
  nested: StepDefObject[]
}
export type StepDef = StepDefObject | StepDefNested

export interface Step {
  id: string
  description: string
  expected: string
  checkpoint: boolean
  done: boolean
  internal: string | null
}

export interface DerivedPlan {
  task: string
  steps: Step[]
  currentStep: number | null
  aborted: boolean
  decisions: string[]
}

const isNested = (step: StepDef): step is StepDefNested => "nested" in step

const findCurrentStep = (steps: Step[]): number | null => {
  const index = steps.findIndex((s) => !s.done)
  return index === -1 ? null : index
}

const markStepDone = (steps: Step[], index: number, internal: string | null): Step[] =>
  steps.map((s, i) => (i === index ? { ...s, done: true, internal } : s))

const flattenSteps = (stepDefs: StepDef[]): Step[] => {
  const steps: Step[] = []
  let topIndex = 0

  for (const def of stepDefs) {
    if (isNested(def)) {
      def.nested.forEach((innerDef, i) => {
        steps.push({
          id: `${topIndex + 1}.${i + 1}`,
          description: innerDef.title,
          expected: innerDef.expected,
          checkpoint: innerDef.checkpoint === true,
          done: false,
          internal: null,
        })
      })
    } else {
      steps.push({
        id: String(topIndex + 1),
        description: def.title,
        expected: def.expected,
        checkpoint: def.checkpoint === true,
        done: false,
        internal: null,
      })
    }
    topIndex++
  }

  return steps
}

const PLAN_MARKER = "<!-- plan: "
const PLAN_MARKER_END = " -->"

export const isPlanMarker = (content: string): boolean => content.startsWith(PLAN_MARKER)

interface PlanPayload {
  task: string
  steps: StepDef[]
  decisions: string[]
}

export const serializePlanBlock = (task: string, steps: StepDef[], decisions: string[]): string =>
  `${PLAN_MARKER}${JSON.stringify({ task, steps, decisions })}${PLAN_MARKER_END}`

export const parsePlanBlock = (content: string): DerivedPlan | null => {
  if (!isPlanMarker(content)) return null
  const json = content.slice(PLAN_MARKER.length, content.lastIndexOf(PLAN_MARKER_END))
  try {
    const { task, steps, decisions } = JSON.parse(json) as PlanPayload
    return {
      task,
      steps: flattenSteps(steps),
      currentStep: 0,
      aborted: false,
      decisions: decisions ?? [],
    }
  } catch {
    return null
  }
}

export const processCompleteStep = (plan: DerivedPlan, internal: string | null): DerivedPlan => {
  if (plan.currentStep === null) return plan
  const newSteps = markStepDone(plan.steps, plan.currentStep, internal)
  return { ...plan, steps: newSteps, currentStep: findCurrentStep(newSteps) }
}

type StepGuard = { allowed: true } | { allowed: false; reason: string }

const allowed: StepGuard = { allowed: true }
const denied = (reason: string): StepGuard => ({ allowed: false, reason })

export const isLastStep = (plan: DerivedPlan): boolean =>
  plan.currentStep !== null && plan.steps.every((s, i) => i === plan.currentStep || s.done)

export const guardCompleteStep = (plan: DerivedPlan): StepGuard => {
  if (plan.currentStep === null) return denied("Plan is already complete — all steps are done.")
  return allowed
}

export const lastPlan = (plans: DerivedPlan[]): DerivedPlan | null => plans.at(-1) ?? null

export const hasActivePlan = (plans: DerivedPlan[]): boolean => {
  const plan = lastPlan(plans)
  return plan !== null && plan.currentStep !== null && !plan.aborted
}

export const isCurrentStepCheckpoint = (plans: DerivedPlan[]): boolean => {
  const plan = lastPlan(plans)
  if (!plan || plan.currentStep === null) return false
  return plan.steps[plan.currentStep].checkpoint
}

export const updateLastPlan = (
  plans: DerivedPlan[],
  fn: (p: DerivedPlan) => DerivedPlan
): DerivedPlan[] => {
  if (plans.length === 0) return plans
  return [...plans.slice(0, -1), fn(plans[plans.length - 1])]
}
