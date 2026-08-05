import type { AnyTool } from "./tool"
import type { Nudger } from "../steering/nudge-tools"
import type { Block } from "../client/blocks"
import { pushBlocks } from "../client/store"
import type { StepDef } from "../derived"
import { serializePlanBlock } from "../derived"
import {
  blockPatchTools,
  blockDeleteTools,
  blockAddTools,
  blockMoveTools,
} from "../tools/block-tools/register"
import { editFile } from "../tools/edit-file/def"
import { createFile } from "../tools/create-file/def"
import { copyFile } from "../tools/copy-file/def"
import { renameFile } from "../tools/rename-file/def"
import { removeFile } from "../tools/remove-file/def"
import { runLocalShell } from "../tools/run-local-shell/def"
import { cancel } from "../tools/cancel/def"
import { applyDeepAnalysisTool } from "../tools/apply-deep-analysis/def"
import { refineCodeTool } from "../tools/refine-code/def"
import { startPlanTool } from "../tools/start-planning/def"
import { completeStep } from "../tools/complete-step/def"
import { askTool } from "../tools/ask/def"
import { submitPlanTool } from "../tools/submit-plan/def"
import { queryTool } from "../tools/query/def"
import { searchTool } from "../tools/search/def"
import { baselineNudge } from "../steering/nudges/baseline"
import { buildToolNudges } from "../steering/nudges"
import { createMemoryNudge } from "../steering/nudges/memory"
import { createSettingsNudge } from "../steering/nudges/settings"
import { createStepStateNudge } from "../steering/nudges/step-state"
import { createPlanProgressNudge } from "../steering/nudges/plan-progress"
import { getFiles } from "~/lib/files/store"
interface ModeConfig {
  tools: AnyTool[]
  triggers: string[]
  prompt?: string
  nudges: Nudger[]
}

type ModeName = "chat" | "plan" | "exec"

const toolNudges = buildToolNudges(getFiles)
const memoryNudge = createMemoryNudge(getFiles)
const settingsNudge = createSettingsNudge(getFiles)
const stepStateNudge = createStepStateNudge(getFiles)
const planProgressNudge = createPlanProgressNudge(getFiles)

const resolveToolNudges = (tools: AnyTool[], nudges: Nudger[]): Nudger[] => {
  const fromTools = tools.flatMap((t) => toolNudges[t.name] ?? [])
  return [...nudges, ...fromTools]
}

const raw: Record<ModeName, ModeConfig> = {
  chat: {
    tools: [
      runLocalShell,
      queryTool,
      searchTool,
      ...blockPatchTools,
      ...blockDeleteTools,
      ...blockAddTools,
      ...blockMoveTools,
      editFile,
      createFile,
      copyFile,
      renameFile,
      removeFile,
      applyDeepAnalysisTool,
      refineCodeTool,
      startPlanTool,
      askTool,
    ],
    triggers: ["cancel"],
    nudges: [baselineNudge, memoryNudge, settingsNudge],
  },
  plan: {
    tools: [runLocalShell, queryTool, searchTool, submitPlanTool, cancel, askTool],
    triggers: [],
    prompt: "planning",
    nudges: [baselineNudge, memoryNudge, settingsNudge],
  },
  exec: {
    tools: [
      runLocalShell,
      queryTool,
      searchTool,
      ...blockPatchTools,
      ...blockDeleteTools,
      ...blockAddTools,
      ...blockMoveTools,
      editFile,
      createFile,
      copyFile,
      renameFile,
      removeFile,
      cancel,
      completeStep,
      applyDeepAnalysisTool,
      askTool,
    ],
    triggers: ["submit_plan"],
    prompt: "execution",
    nudges: [baselineNudge, memoryNudge, settingsNudge, stepStateNudge, planProgressNudge],
  },
}

export const modes: Record<ModeName, ModeConfig> = Object.fromEntries(
  Object.entries(raw).map(([k, m]) => [k, { ...m, nudges: resolveToolNudges(m.tools, m.nudges) }])
) as Record<ModeName, ModeConfig>

const triggerToMode: Record<string, ModeName> = Object.fromEntries(
  Object.entries(modes).flatMap(([mode, config]) =>
    config.triggers.map((trigger) => [trigger, mode as ModeName])
  )
)

export const DEFAULT_MODE: ModeName = "chat"

export const ENDPOINT = "/qual-coder"

const promptToMode: Record<string, ModeName> = {
  planning: "plan",
  execution: "exec",
  chat: "chat",
}

const modeFromPromptMarker = (content: string): ModeName | undefined => {
  const match = content.match(/<!-- prompt: (\w+) -->/)
  return match ? promptToMode[match[1]] : undefined
}

export const deriveMode = (blocks: Block[]): ModeName => {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.type === "tool_result" && block.toolName) {
      const mode = triggerToMode[block.toolName]
      if (mode) return mode
    }
    if (block.type === "system") {
      const mode = modeFromPromptMarker(block.content)
      if (mode) return mode
    }
  }
  return DEFAULT_MODE
}

export const modeSystemBlocks = (mode: ModeName): Block[] => {
  const config = modes[mode]
  if (!config.prompt) return []
  return [{ type: "system", content: `<!-- prompt: ${config.prompt} -->` }]
}

export const activatePlan = (task: string, steps: StepDef[], decisions: string[]): void => {
  pushBlocks([{ type: "system", content: serializePlanBlock(task, steps, decisions) }])
  pushBlocks(modeSystemBlocks("exec"))
}

export const deactivatePlan = (): void => {
  pushBlocks([{ type: "system", content: "<!-- prompt: chat -->" }])
}

const allKnownToolNames = new Set<string>(
  Object.values(modes).flatMap((m) => m.tools.map((t) => t.name))
)

const buildAvailableToolNames = (mode: ModeName): Set<string> => {
  const names = new Set(modes[mode].tools.map((t) => t.name))
  names.add("cancel")
  return names
}

export const checkToolAvailability = (toolName: string, mode: ModeName): string | null => {
  const available = buildAvailableToolNames(mode)
  if (available.has(toolName)) return null
  if (allKnownToolNames.has(toolName)) return `Tool "${toolName}" is not available in ${mode} mode.`
  return `Tool "${toolName}" does not exist. Available tools: ${[...available].sort().join(", ")}`
}
