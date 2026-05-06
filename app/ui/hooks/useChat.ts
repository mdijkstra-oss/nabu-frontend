import { useSyncExternalStore, useCallback } from "react"
import type { Block, SystemBlock } from "~/lib/agent/client/blocks"
import {
  getAllBlocksWithDraft,
  getDraft,
  subscribeBlocks,
  pushBlocks,
  subscribeLoading,
  getLoading,
} from "~/lib/agent/client/store"
import { run, cancel as cancelRunner, type RunnerDeps } from "~/lib/agent/runner"
import { getPageContext, findLastContextMessage } from "~/lib/editor/chat-context"

export const useChat = () => {
  const history = useSyncExternalStore(
    subscribeBlocks,
    getAllBlocksWithDraft,
    getAllBlocksWithDraft
  )
  const draft = useSyncExternalStore(subscribeBlocks, getDraft, getDraft)
  const loading = useSyncExternalStore(subscribeLoading, getLoading, getLoading)

  const send = useCallback((content: string, deps?: RunnerDeps) => {
    const userBlock: Block = { type: "user", content }
    const blocksToAdd: Block[] = []

    const ctx = getPageContext()
    if (ctx) {
      const lastSent = findLastContextMessage(getAllBlocksWithDraft())
      if (ctx !== lastSent) {
        const contextBlock: SystemBlock = { type: "system", content: ctx }
        blocksToAdd.push(contextBlock)
      }
    }

    blocksToAdd.push(userBlock)
    pushBlocks(blocksToAdd)
    run(deps)
  }, [])

  const runChat = useCallback((deps?: RunnerDeps) => {
    run(deps)
  }, [])

  const respond = useCallback((content: string) => {
    const userBlock: Block = { type: "user", content }
    pushBlocks([userBlock])
  }, [])

  const cancel = useCallback(() => {
    cancelRunner()
  }, [])

  return { send, respond, run: runChat, cancel, loading, draft, history }
}
