import { z } from "zod"
import type { AnyTool } from "../../executors/tool"

export const AskArgs = z.object({
  question: z.string().describe("A focused question with enough context for the user to decide."),
  options: z
    .array(
      z.object({
        label: z.string().describe("Short option text the user sees and clicks."),
        expected: z
          .string()
          .describe("What you will do when this option is selected — returned as tool output."),
      })
    )
    .min(2)
    .describe("Concrete, actionable choices."),
})

export type AskOption = z.infer<typeof AskArgs>["options"][number]

export const askTool: AnyTool = {
  name: "ask",
  description:
    "Ask the user a question. Every question must go through this tool — never ask in chat text. Always provide options. Execution pauses until answered. Call once per question — earlier answers may shape later questions.\n\nparallel: no — blocks on user response",
  schema: AskArgs,
}
