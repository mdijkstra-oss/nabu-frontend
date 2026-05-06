import type { ToolDeps } from "~/lib/agent/types"
import { createToolExecutor } from "~/lib/agent/executors"
import {
  setDraft,
  getDraft,
  clearStreaming,
  pushBlocks,
  setLoading,
} from "~/lib/agent/client/store"
import { agentLoop } from "~/lib/agent/agent-loop"
import { waitForUser } from "~/lib/agent/executors/delegation"
import { modeSystemBlocks, DEFAULT_MODE } from "~/lib/agent/executors/modes"
import { fetchApproachMeta } from "~/lib/modes/approaches"
import { isAbortError, errorMessage } from "~/lib/utils/error"

export type RunnerDeps = ToolDeps

const stop = () => {
  setLoading(false)
  clearStreaming()
}

let active = false
let controller: AbortController | null = null

const appendToTextDraft = (chunk: string): void => {
  const current = getDraft()
  const content = current?.type === "text" ? current.content + chunk : chunk
  setDraft({ type: "text", content })
}

const appendToReasoningDraft = (chunk: string): void => {
  const current = getDraft()
  const content = current?.type === "reasoning" ? current.content + chunk : chunk
  setDraft({ type: "reasoning", content })
}

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

const buildCallbacks = () => ({
  onChunk: (chunk: string) => appendToTextDraft(chunk),
  onReasoningChunk: (chunk: string) => appendToReasoningDraft(chunk),
  onToolName: (name: string) => {
    setDraft({
      type: "tool_call",
      calls: [{ id: "", name, args: "" as unknown as Record<string, unknown> }],
    })
  },
  onToolArgsChunk: (chunk: string) => appendToToolArgsDraft(chunk),
  onStreamEnd: () => undefined,
})

const runAgent = async (deps: RunnerDeps): Promise<void> => {
  controller = new AbortController()
  const executor = createToolExecutor(deps)
  const callbacks = buildCallbacks()
  pushBlocks(modeSystemBlocks(DEFAULT_MODE))
  setLoading(true)

  while (true) {
    await agentLoop({
      executor,
      callbacks,
      signal: controller.signal,
    })
    stop()
    await waitForUser(controller.signal)
    setLoading(true)
  }
}

export const run = async (deps: RunnerDeps = {}): Promise<void> => {
  if (active) return
  active = true
  try {
    await fetchApproachMeta()
    await runAgent(deps)
  } catch (e) {
    if (!isAbortError(e)) {
      console.error(e)
      pushBlocks([{ type: "error", content: errorMessage(e) }])
    }
  } finally {
    active = false
    controller = null
    stop()
  }
}

export const cancel = (): void => {
  if (!active) return
  controller?.abort()
}
