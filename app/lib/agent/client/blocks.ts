export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  extraContent?: unknown
}

export interface TextBlock {
  type: "text"
  content: string
  draft?: true
}

export interface ToolCallBlock {
  type: "tool_call"
  calls: ToolCall[]
  draft?: true
}

export interface ToolResultBlock {
  type: "tool_result"
  callId: string
  toolName?: string
  result: unknown
}

export interface UserBlock {
  type: "user"
  content: string
}

export interface SystemBlock {
  type: "system"
  content: string
}

export interface ReasoningBlock {
  type: "reasoning"
  content: string
  id?: string
  encryptedContent?: string
  extraContent?: unknown
  draft?: true
}

export interface EmptyNudgeBlock {
  type: "empty_nudge"
}

export interface ErrorBlock {
  type: "error"
  content: string
  errorType?: string
}

export interface ProgressBlock {
  type: "progress"
  label: string
}

export interface DebugPauseBlock {
  type: "debug_pause"
}

export type Block = (
  | TextBlock
  | ToolCallBlock
  | ToolResultBlock
  | UserBlock
  | SystemBlock
  | ReasoningBlock
  | EmptyNudgeBlock
  | ErrorBlock
  | ProgressBlock
  | DebugPauseBlock
) & { timestamp?: number; source?: string; streaming?: true }
