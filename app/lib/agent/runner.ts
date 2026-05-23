import type { ToolDeps } from "~/lib/agent/types"
import { createToolExecutor } from "~/lib/agent/executors"
import {
  setDraft,
  getDraft,
  clearStreaming,
  showProgress,
  pushBlocks,
  setLoading,
} from "~/lib/agent/client/store"
import { cancelPendingCalls } from "~/lib/agent/client/raw-store"
import { agentLoop } from "~/lib/agent/agent-loop"
import { waitForUser } from "~/lib/agent/executors/delegation"
import { modeSystemBlocks, DEFAULT_MODE } from "~/lib/agent/executors/modes"
import { isAbortError, errorMessage } from "~/lib/utils/error"
import { setActiveSignal } from "~/lib/utils/signal"

export type RunnerDeps = ToolDeps

const stop = () => {
  setLoading(false)
  clearStreaming()
}

let active = false
let controller: AbortController | null = null

const appendToToolArgsDraft = (chunk: string): void => {
  const current = getDraft()
  if (current?.type === "tool_call") {
    const call = current.calls[0]
    const argsStr = (call.args as unknown as string) + chunk
    setDraft({
      type: "tool_call",
      calls: [{ ...call, args: argsStr as unknown as Record<string, unknown> }],
    })
    return
  }
  setDraft({
    type: "tool_call",
    calls: [{ id: "", name: "", args: chunk as unknown as Record<string, unknown> }],
  })
}

const buildCallbacks = () => {
  let textContent = ""
  let reasoningContent = ""
  return {
    onChunk: (chunk: string) => {
      textContent += chunk
      setDraft({ type: "text", content: textContent })
    },
    onReasoningChunk: (chunk: string) => {
      reasoningContent += chunk
      setDraft({ type: "reasoning", content: reasoningContent })
    },
    onToolName: (name: string) => {
      textContent = ""
      setDraft({
        type: "tool_call",
        calls: [{ id: "", name, args: "" as unknown as Record<string, unknown> }],
      })
    },
    onToolArgsChunk: (chunk: string) => appendToToolArgsDraft(chunk),
    onStreamEnd: () => {
      textContent = ""
      reasoningContent = ""
    },
  }
}

const runAgent = async (deps: RunnerDeps): Promise<void> => {
  controller = new AbortController()
  setActiveSignal(controller.signal)
  const executor = createToolExecutor(deps)
  const callbacks = buildCallbacks()
  pushBlocks(modeSystemBlocks(DEFAULT_MODE))
  setLoading(true)

  while (true) {
    try {
      await agentLoop({
        executor,
        callbacks,
        signal: controller.signal,
      })
    } catch (e) {
      if (!isAbortError(e)) throw e
      controller = new AbortController()
      setActiveSignal(controller.signal)
      clearStreaming()
      continue
    }
    stop()
    await waitForUser(controller.signal)
    setLoading(true)
  }
}

export const run = async (deps: RunnerDeps = {}): Promise<void> => {
  if (active) return
  active = true
  try {
    await runAgent(deps)
  } catch (e) {
    if (!isAbortError(e)) {
      console.error(e)
      pushBlocks([{ type: "error", content: errorMessage(e) }])
    }
  } finally {
    active = false
    controller = null
    setActiveSignal(null)
    stop()
  }
}

export const cancel = (): void => {
  if (!active) return
  showProgress("Cancelling…")
  controller?.abort()
  cancelPendingCalls()
}
