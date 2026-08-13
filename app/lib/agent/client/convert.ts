import type { z } from "zod"
import type { Block } from "./blocks"
import { dropNumericBounds, toStrictSchema } from "../executors/strict-schema"

export interface InputTextPart {
  type: "input_text"
  text: string
  prompt_cache_breakpoint?: { mode: "explicit" }
}

export type MessageContent = string | InputTextPart[]

// Only the items this app authors are described here. An item the model produced is
// echoed back as the object it arrived as, so its shape is the backend's to define.
type InputItem =
  | { type: "message"; role: "system" | "user" | "assistant"; content: MessageContent }
  | { type: "function_call"; call_id: string; status: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; status: string; output: string }

export interface ResponseFormat {
  type: "json_schema"
  name: string
  schema: unknown
  strict: boolean
}

export const toResponseFormat = <T extends z.ZodType>(schema: T): ResponseFormat => ({
  type: "json_schema",
  name: "response",
  schema: dropNumericBounds(toStrictSchema(schema.toJSONSchema())),
  strict: true,
})

export const extractText = (blocks: Block[]): string => {
  const textBlock = blocks.find((b) => b.type === "text")
  return textBlock?.type === "text" ? textBlock.content : ""
}

const blockToInputItem = (block: Block): InputItem | InputItem[] => {
  if (block.type === "system") {
    return { type: "message", role: "system", content: block.content }
  }
  if (block.type === "text") {
    return { type: "message", role: "assistant", content: block.content }
  }
  if (block.type === "user") {
    return { type: "message", role: "user", content: block.content }
  }
  if (block.type === "tool_call") {
    return block.calls.map((c) =>
      c.raw !== undefined
        ? (c.raw as InputItem)
        : {
            type: "function_call" as const,
            call_id: c.id,
            status: "completed",
            name: c.name,
            arguments: JSON.stringify(c.args),
          }
    )
  }
  if (block.type === "tool_result") {
    return {
      type: "function_call_output" as const,
      call_id: block.callId,
      status: "completed",
      output: JSON.stringify(block.result),
    }
  }
  // A reasoning block with no item behind it was drafted here during streaming and was
  // never the model's to begin with.
  if (block.type === "reasoning") {
    return block.raw !== undefined ? (block.raw as InputItem) : []
  }
  if (block.type === "progress") {
    return []
  }
  if (block.type === "empty_nudge") {
    return []
  }
  if (block.type === "debug_pause") {
    return []
  }
  return []
}

export const blocksToMessages = (blocks: Block[]): InputItem[] => blocks.flatMap(blockToInputItem)

export const toSystem = (content: string) => ({
  type: "message" as const,
  role: "system" as const,
  content,
})

export const toUser = (content: string) => ({
  type: "message" as const,
  role: "user" as const,
  content,
})

export type { InputItem }
