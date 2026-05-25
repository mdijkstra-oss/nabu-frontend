import type { Block } from "./blocks"
import type { ParseCallbacks } from "./parse"
import { getActiveSignal } from "~/lib/utils/signal"

export const isDraft = (block: Block): boolean => "draft" in block && block.draft === true

const isStreaming = (block: Block): boolean => block.streaming === true

let blocks: Block[] = []
let listeners: (() => void)[] = []
let loading = false
let loadingListeners: (() => void)[] = []

const notify = (): void => listeners.forEach((l) => l())
const notifyLoading = (): void => loadingListeners.forEach((l) => l())

const lastIsDraft = (): boolean => blocks.length > 0 && isDraft(blocks[blocks.length - 1])

const stripStreaming = (bs: Block[]): Block[] => bs.filter((b) => !isStreaming(b))

const stamp = (block: Block, source: string): Block => ({ ...block, timestamp: Date.now(), source })

export const pushBlocks = (newBlocks: Block[], source = "base"): void => {
  blocks = [...stripStreaming(blocks), ...newBlocks.map((b) => stamp(b, source))]
  notify()
}

export const getSource = (block: Block): string => block.source ?? "base"

export const filterBySource = (blocks: Block[], source: string): Block[] =>
  blocks.filter((b) => getSource(b) === source)

const solidifyDraft = (block: Block): Block => {
  const { draft: _draft, ...rest } = block as Block & { draft?: true }
  return rest as Block
}

export const setDraft = (block: Block): void => {
  const tagged = { ...stamp(block, "base"), draft: true as const, streaming: true as const }
  if (lastIsDraft()) {
    const current = blocks[blocks.length - 1]
    const isTypeChange = current.type !== block.type
    if (isTypeChange) {
      blocks = [...blocks.slice(0, -1), solidifyDraft(current), tagged]
    } else {
      blocks = [...blocks.slice(0, -1), tagged]
    }
  } else {
    blocks = [...blocks, tagged]
  }
  notify()
}

export const getDraft = (): Block | null => {
  const last = blocks[blocks.length - 1]
  return last && isDraft(last) ? last : null
}

export const clearStreaming = (): void => {
  const filtered = stripStreaming(blocks)
  if (filtered.length === blocks.length) return
  blocks = filtered
  notify()
}

export const setLoading = (value: boolean): void => {
  loading = value
  notifyLoading()
}

export const getLoading = (): boolean => loading

export const subscribeLoading = (listener: () => void): (() => void) => {
  loadingListeners = [...loadingListeners, listener]
  return () => {
    loadingListeners = loadingListeners.filter((l) => l !== listener)
  }
}

export const getAllBlocks = (): Block[] => blocks.filter((b) => !isDraft(b))

export const getAllBlocksWithDraft = (): Block[] => blocks

export const clearBlocks = (): void => {
  blocks = []
  notify()
}

export const showProgress = (label: string): void => {
  if (getActiveSignal()?.aborted) return
  setDraft({ type: "progress", label })
}

export const buildStreamingCallbacks = (prefix: string): ParseCallbacks => {
  let textContent = ""
  return {
    onChunk: (chunk: string) => {
      textContent += chunk
      setDraft({ type: "text", content: prefix + textContent })
    },
    onStreamEnd: () => {
      textContent = ""
    },
  }
}

export const clearPauseBlocks = (): void => {
  const filtered = blocks.filter((b) => b.type !== "debug_pause")
  if (filtered.length === blocks.length) return
  blocks = filtered
  notify()
}

export const subscribeBlocks = (listener: () => void): (() => void) => {
  listeners = [...listeners, listener]
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}
