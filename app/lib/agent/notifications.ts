import { isDebugPauseBlock, isErrorResult } from "./derived"
import type { Block } from "./client/blocks"
import { truncateLabel } from "~/lib/mutation-history/presentation"

export interface NotificationEvent {
  title: string
  body: string
}

type NotificationMapper = (block: Block, allBlocks: Block[]) => NotificationEvent | null

const formatBody = (text: string): string => truncateLabel(text.replace(/\n/g, " ").trim(), 80)

const findToolCallArg = (blocks: Block[], callId: string, argName: string): string | null => {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.type !== "tool_call") continue
    const call = block.calls.find((c) => c.id === callId)
    if (!call) continue
    const value = call.args[argName]
    return typeof value === "string" ? value : null
  }
  return null
}

const findCallArg = (block: Block, toolName: string, argName: string): string | null => {
  if (block.type !== "tool_call") return null
  const call = block.calls.find((c) => c.name === toolName)
  if (!call) return null
  const value = call.args[argName]
  return typeof value === "string" ? value : null
}

const isSuccessfulResult = (block: Block, toolName: string): boolean =>
  block.type === "tool_result" && block.toolName === toolName && !isErrorResult(block.result)

const mapPlanCreated: NotificationMapper = (block, allBlocks) => {
  if (block.type !== "tool_result" || !isSuccessfulResult(block, "submit_plan")) return null
  const task = findToolCallArg(allBlocks, block.callId, "task") ?? "New plan submitted"
  return { title: "Nabu — Plan", body: formatBody(task) }
}

const mapStepComplete: NotificationMapper = (block) => {
  if (block.type !== "tool_result" || !isSuccessfulResult(block, "complete_step")) return null
  return { title: "Nabu — Step Done", body: "Step completed" }
}

const mapMessage: NotificationMapper = (block) => {
  if (block.type !== "text") return null
  return { title: "Nabu", body: formatBody(block.content || "Agent responded") }
}

const mapDebugPause: NotificationMapper = (block) => {
  if (!isDebugPauseBlock(block)) return null
  return { title: "Nabu — Paused", body: "Tool error — waiting for continue" }
}

const mapAskCall: NotificationMapper = (block) => {
  const question = findCallArg(block, "ask", "question")
  if (!question) return null
  return { title: "Nabu — Waiting", body: formatBody(question) }
}

const mappers: NotificationMapper[] = [
  mapPlanCreated,
  mapStepComplete,
  mapMessage,
  mapDebugPause,
  mapAskCall,
]

const firstMatch = (block: Block, allBlocks: Block[]): NotificationEvent | null => {
  for (const mapper of mappers) {
    const event = mapper(block, allBlocks)
    if (event) return event
  }
  return null
}

export const isTextEvent = (event: NotificationEvent): boolean => event.title === "Nabu"

export const detectBlockEvents = (newBlocks: Block[], allBlocks: Block[]): NotificationEvent[] =>
  newBlocks.flatMap((block) => {
    const event = firstMatch(block, allBlocks)
    return event ? [event] : []
  })
