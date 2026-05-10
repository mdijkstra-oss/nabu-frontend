import type { TaskConfig } from "../dispatch"

export const codeAllCodebooks: TaskConfig = {
  context:
    "Use ls --show-tags to find codebooks, then use plan_deep_analysis to start coding of file. Do not use scout. Include ALL codebooks. General Codebook is framework, other codebooks are dimensions",
  userMessage: "Can you code this file",
}

export const codeWithCodebook = (codeId: string): TaskConfig => {
  const codeFile = `${codeId}.generated.hidden.md`
  return {
    context: `Use ls --show-tags to find codebooks, then use plan_deep_analysis to start coding of file. Do not use scout. Use ONLY the generic codebook AND ${codeFile} for coding. Do not use any other codebooks. Note: ${codeFile} is a generated file — it will not appear in ls output, but can be read with cat, head, tail, or grep.`,
    userMessage: `Can you code this file with only ${codeId}`,
  }
}

export const removeCodings: TaskConfig = {
  context: "",
  userMessage: "Can you clear all codings of this file",
}

export const autoGreetingDirective = (time: string): string =>
  `IMPORTANT: The message above is an AUTO-GENERATED greeting sent on page load. The user did NOT type this. It is NOT a request or instruction. Do NOT use tools, read files, make plans, or take any action. Reply with a short, warm, casual greeting (1-2 sentences max) that matches the vibe and tone of the user's message, and nothing else. DO NOT TOOL CALL NOW. ONLY reply with a greeting, then STOP and wait for user. Current time: ${time}.`
