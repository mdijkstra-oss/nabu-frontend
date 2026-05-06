import type { Block, SystemBlock } from "./client"
import { pushBlocks, getLoading, getAllBlocksWithDraft } from "./client"
import { toMarkerBlock } from "./client/markers"
import { isCompactedResult } from "./compact"
import { run, type RunnerDeps } from "./runner"
import { getPageContext, findLastContextMessage } from "~/lib/editor/chat-context"

export interface TaskConfig {
  approaches: string[]
  context: string
  userMessage: string
}

const MODE_DIRECTIVE = /^<!-- (?:model|reasoning|verbosity|prompt): .+ -->$/

const isModeDirective = (block: Block): boolean =>
  block.type === "system" && MODE_DIRECTIVE.test(block.content)

const MAX_DEDUP_LOOKBACK = 75

const dedupFloor = (history: Block[]): number => {
  const lookbackFloor = Math.max(0, history.length - MAX_DEDUP_LOOKBACK)
  for (let i = history.length - 1; i >= lookbackFloor; i--) {
    if (isCompactedResult(history[i])) return i + 1
  }
  return lookbackFloor
}

const collectRecentSystemContents = (history: Block[]): Set<string> => {
  const floor = dedupFloor(history)
  const contents = new Set<string>()
  for (let i = floor; i < history.length; i++) {
    const block = history[i]
    if (block.type === "system" && !isModeDirective(block)) {
      contents.add(block.content)
    }
  }
  return contents
}

const isNewBlock =
  (existing: Set<string>) =>
  (block: Block): boolean =>
    block.type !== "system" || isModeDirective(block) || !existing.has(block.content)

export const buildTaskBlocks = (config: TaskConfig, currentHistory: Block[]): Block[] => {
  const blocks: Block[] = config.approaches.map(toMarkerBlock)

  const ctx = getPageContext()
  if (ctx) {
    const lastSent = findLastContextMessage(currentHistory)
    if (ctx !== lastSent) {
      blocks.push({ type: "system", content: ctx } satisfies SystemBlock)
    }
  }

  blocks.push({ type: "system", content: config.context } satisfies SystemBlock)
  blocks.push({ type: "user", content: config.userMessage })

  const existing = collectRecentSystemContents(currentHistory)
  return blocks.filter(isNewBlock(existing))
}

export const dispatchTask = (config: TaskConfig, deps?: RunnerDeps): void => {
  if (getLoading()) return
  const blocks = buildTaskBlocks(config, getAllBlocksWithDraft())
  pushBlocks(blocks)
  run(deps)
}
