import type { Block, SystemBlock } from "~/lib/agent/client/blocks"

export type GetContextFn = () => string | null

export const CONTEXT_PREFIX =
  "User is NOW looking at any 'this file' reference refers to the file named here:"

let baseContextFn: GetContextFn | undefined
let overrideContextFn: GetContextFn | undefined

export const setPageContext = (fn: GetContextFn | undefined): void => {
  baseContextFn = fn
}

export const setPageContextOverride = (fn: GetContextFn | undefined): void => {
  overrideContextFn = fn
}

export const getPageContext = (): string | null =>
  overrideContextFn?.() ?? baseContextFn?.() ?? null

const isContextBlock = (block: Block): block is SystemBlock =>
  block.type === "system" && block.content.startsWith(CONTEXT_PREFIX)

export const findLastContextMessage = (history: Block[]): string | null => {
  for (let i = history.length - 1; i >= 0; i--) {
    const block = history[i]
    if (isContextBlock(block)) {
      return block.content
    }
  }
  return null
}
