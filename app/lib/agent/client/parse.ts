import type { Block, ToolCall } from "./blocks"

export interface ParseCallbacks {
  onChunk?: (text: string) => void
  onToolArgsChunk?: (text: string) => void
  onReasoningChunk?: (text: string) => void
  onBlock?: (block: Block) => void
  onToolName?: (name: string) => void
  onToolCall?: (call: ToolCall) => void
  onStreamEnd?: () => void
}

interface ParseState {
  currentEvent: string
  textContent: string
  reasoningContent: string
  reasoningId: string | undefined
  reasoningEncryptedContent: string | undefined
  reasoningExtraContent: unknown | undefined
  pendingToolCalls: ToolCall[]
  streamingToolName: string | null
  blocks: Block[]
}

export const initialParseState = (): ParseState => ({
  currentEvent: "",
  textContent: "",
  reasoningContent: "",
  reasoningId: undefined,
  reasoningEncryptedContent: undefined,
  reasoningExtraContent: undefined,
  pendingToolCalls: [],
  streamingToolName: null,
  blocks: [],
})

const parseToolArgs = (args: string): Record<string, unknown> => {
  try {
    return JSON.parse(args) as Record<string, unknown>
  } catch {
    return {}
  }
}

const flushReasoning = (state: ParseState): ParseState =>
  state.reasoningContent
    ? {
        ...state,
        reasoningContent: "",
        reasoningId: undefined,
        reasoningEncryptedContent: undefined,
        reasoningExtraContent: undefined,
        blocks: [
          ...state.blocks,
          {
            type: "reasoning",
            content: state.reasoningContent,
            id: state.reasoningId,
            encryptedContent: state.reasoningEncryptedContent,
            extraContent: state.reasoningExtraContent,
          },
        ],
      }
    : state

const flushText = (state: ParseState): ParseState =>
  state.textContent
    ? {
        ...state,
        textContent: "",
        blocks: [...state.blocks, { type: "text", content: state.textContent }],
      }
    : state

const flushToolCalls = (state: ParseState): ParseState =>
  state.pendingToolCalls.length > 0
    ? {
        ...state,
        pendingToolCalls: [],
        blocks: [...state.blocks, { type: "tool_call", calls: state.pendingToolCalls }],
      }
    : state

export const processLine = (
  line: string,
  state: ParseState,
  callbacks: ParseCallbacks
): ParseState => {
  if (line.startsWith("event: ")) {
    return { ...state, currentEvent: line.slice(7) }
  }

  if (!line.startsWith("data: ")) return state

  const data = line.slice(6)

  try {
    const parsed = JSON.parse(data)

    if (state.currentEvent === "response.output_text.delta") {
      if (parsed.delta) {
        callbacks.onChunk?.(parsed.delta)
        const flushed = flushToolCalls(state)
        return { ...flushed, textContent: flushed.textContent + parsed.delta }
      }
    }

    if (state.currentEvent === "response.output_item.added") {
      if (parsed.item?.type === "function_call") {
        const name = parsed.item.name
        if (name && name !== state.streamingToolName) {
          callbacks.onToolName?.(name)
          const flushed = flushReasoning(flushText(state))
          return { ...flushed, streamingToolName: name }
        }
      }
    }

    if (state.currentEvent === "response.function_call_arguments.delta") {
      if (parsed.delta) {
        callbacks.onToolArgsChunk?.(parsed.delta)
      }
      return state
    }

    if (state.currentEvent === "response.reasoning_summary_text.delta") {
      if (parsed.delta) {
        callbacks.onReasoningChunk?.(parsed.delta)
        const flushed = flushToolCalls(state)
        return { ...flushed, reasoningContent: flushed.reasoningContent + parsed.delta }
      }
      return state
    }

    if (state.currentEvent === "response.failed") {
      const error = parsed?.response?.error
      if (error?.message) {
        const flushed = flushReasoning(flushText(flushToolCalls(state)))
        return {
          ...flushed,
          blocks: [
            ...flushed.blocks,
            { type: "error", content: error.message, errorType: error.type },
          ],
        }
      }
      return state
    }

    if (state.currentEvent === "response.output_item.done" && parsed.item) {
      const item = parsed.item
      if (item.type === "function_call") {
        const toolCall: ToolCall = {
          id: item.call_id,
          name: item.name,
          args: parseToolArgs(item.arguments),
          ...(item.extra_content ? { extraContent: item.extra_content } : {}),
        }
        callbacks.onToolCall?.(toolCall)
        return { ...state, pendingToolCalls: [...state.pendingToolCalls, toolCall] }
      }
      if (item.type === "reasoning") {
        return {
          ...state,
          reasoningId: item.id,
          reasoningEncryptedContent: item.encrypted_content,
          reasoningExtraContent: item.extra_content,
        }
      }
    }

    return state
  } catch {
    return state
  }
}

export const stateToBlocks = (state: ParseState): Block[] => {
  const flushed = flushToolCalls(flushText(flushReasoning(state)))
  return flushed.blocks
}
