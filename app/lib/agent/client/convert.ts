import type { z } from "zod"
import type { Block } from "./blocks"
import { toStrictSchema } from "../executors/strict-schema"

export interface InputTextPart {
  type: "input_text"
  text: string
  prompt_cache_breakpoint?: { mode: "explicit" }
}

export type MessageContent = string | InputTextPart[]

type InputItem =
  | { type: "message"; role: "system" | "user" | "assistant"; content: MessageContent }
  | {
      type: "function_call"
      call_id: string
      status: string
      name: string
      arguments: string
      extra_content?: unknown
    }
  | { type: "function_call_output"; call_id: string; status: string; output: string }
  | {
      type: "reasoning"
      id: string
      summary?: { type: "summary_text"; text: string }[]
      encrypted_content?: string
      extra_content?: unknown
    }

export interface ResponseFormat {
  type: "json_schema"
  name: string
  schema: unknown
  strict: boolean
}

export const toResponseFormat = <T extends z.ZodType>(schema: T): ResponseFormat => ({
  type: "json_schema",
  name: "response",
  schema: toStrictSchema(schema.toJSONSchema()),
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
    return block.calls.map((c) => ({
      type: "function_call" as const,
      call_id: c.id,
      status: "completed",
      name: c.name,
      arguments: JSON.stringify(c.args),
      ...(c.extraContent ? { extra_content: c.extraContent } : {}),
    }))
  }
  if (block.type === "tool_result") {
    return {
      type: "function_call_output" as const,
      call_id: block.callId,
      status: "completed",
      output: JSON.stringify(block.result),
    }
  }
  if (block.type === "reasoning") {
    const hasEncrypted = !!block.encryptedContent
    const hasExtra = !!block.extraContent
    if (!hasEncrypted && !hasExtra) return []
    return {
      type: "reasoning" as const,
      id: block.id ?? "",
      ...(hasEncrypted
        ? {
            summary: [{ type: "summary_text" as const, text: block.content }],
            encrypted_content: block.encryptedContent,
          }
        : {}),
      ...(hasExtra ? { extra_content: block.extraContent } : {}),
    }
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
