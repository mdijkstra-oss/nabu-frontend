import { getAllBlocks } from "../../client/store"
import { derive, hasAskSinceStepChange } from "../../derived"
import { tool, registerTool } from "../../executors/tool"
import { completeStep as def } from "./def"

type StepKind = "final" | "checkpoint" | "continue"

const classifyStep = (): StepKind => {
  const blocks = getAllBlocks()
  const { plans } = derive(blocks)
  const plan = plans.at(-1)
  if (!plan || plan.currentStep === null) return "continue"
  if (plan.currentStep === plan.steps.length - 1) return "final"
  if (plan.steps[plan.currentStep].checkpoint && !hasAskSinceStepChange(blocks)) return "checkpoint"
  return "continue"
}

const STEP_DIRECTIVE: Record<StepKind, string> = {
  final: "Plan complete.",
  checkpoint: "Make no tool calls. Wait for user response.",
  continue: "Do not write — make your next tool call immediately.",
}

const _completeStep = registerTool(
  tool({
    ...def,
    handler: async (_files, args) => {
      const kind = classifyStep()
      return {
        status: "ok",
        output: args,
        directive: STEP_DIRECTIVE[kind],
        mutations: [],
      }
    },
  })
)
