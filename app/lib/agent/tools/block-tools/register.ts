import type { AnyTool } from "../../executors/tool"
import { getBlockConfig } from "~/lib/data-blocks/registry"
import {
  generatePatchTool,
  generateDeleteTool,
  generateAddTool,
  generateMoveTool,
} from "./generate"

const BLOCK_TOOL_LANGUAGES = [
  "json-attributes",
  "json-annotations",
  "json-callout",
  "json-settings",
  "json-chart",
]

const mustGetConfig = (language: string) => {
  const config = getBlockConfig(language)
  if (!config) throw new Error(`no block config for ${language}`)
  return config
}

const buildEntry = (language: string): AnyTool[] => {
  const config = mustGetConfig(language)
  const tools: AnyTool[] = [
    generatePatchTool(language, config),
    generateDeleteTool(language, config),
  ]
  if (!config.singleton) {
    tools.push(generateAddTool(language, config))
    tools.push(generateMoveTool(language, config))
  }
  return tools
}

const allTools = BLOCK_TOOL_LANGUAGES.flatMap(buildEntry)

export const blockPatchTools: AnyTool[] = allTools.filter((t) => t.name.startsWith("patch_"))
export const blockDeleteTools: AnyTool[] = allTools.filter((t) => t.name.startsWith("delete_"))
export const blockAddTools: AnyTool[] = allTools.filter((t) => t.name.startsWith("add_"))
export const blockMoveTools: AnyTool[] = allTools.filter((t) => t.name.startsWith("move_"))
export const blockTools: AnyTool[] = allTools
