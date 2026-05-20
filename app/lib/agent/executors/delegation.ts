import type { Block, ToolCall } from "../client/blocks"
import type { ToolResult } from "../types"
import type { ToolExecutor } from "../turn"
import { pushBlocks, getAllBlocks, subscribeBlocks } from "../client/store"
import { getFiles } from "~/lib/files/store"
import { derive, lastPlan, guardCompleteStep } from "../derived"
import { deriveMode, modeSystemBlocks, checkToolAvailability } from "./modes"

type SpecialHandler = (call: { args: unknown }) => Promise<ToolResult<unknown>>

const specialHandlers = new Map<string, SpecialHandler>()

export const registerSpecialHandler = (name: string, handler: SpecialHandler): void => {
  specialHandlers.set(name, handler)
}

export const hasNewUserBlock = (blocks: Block[], before: number): boolean =>
  blocks.length > before && blocks.slice(before).some((b) => b.type === "user")

export const waitForUser = (signal?: AbortSignal): Promise<void> => {
  const before = getAllBlocks().length
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const cleanup = () => {
      unsub()
      if (signal) signal.removeEventListener("abort", onAbort)
    }

    const unsub = subscribeBlocks(() => {
      if (hasNewUserBlock(getAllBlocks(), before)) {
        cleanup()
        resolve()
      }
    })

    const onAbort = () => {
      cleanup()
      reject(signal?.reason)
    }

    if (signal) signal.addEventListener("abort", onAbort, { once: true })
  })
}

const handleCancelInMode = (call: ToolCall): ToolResult<unknown> => {
  const blocks = getAllBlocks()
  const mode = deriveMode(blocks)
  if (mode === "chat") return { status: "error", output: "Nothing to cancel." }
  pushBlocks(modeSystemBlocks("chat"))
  const reason = (call.args as { reason?: string }).reason ?? "Cancelled"
  return { status: "ok", output: `Cancelled: ${reason}.` }
}

const isStepGuarded = (name: string): boolean => name === "complete_step"

const guardMap = { complete_step: guardCompleteStep } as const

const checkStepGuard = (call: ToolCall): ToolResult<unknown> | null => {
  const guardFn = guardMap[call.name as keyof typeof guardMap]
  if (!guardFn) return null

  const blocks = getAllBlocks()
  const d = derive(blocks, getFiles())
  const plan = lastPlan(d.plans)
  if (!plan) return null

  const guard = guardFn(plan)
  if (!guard.allowed) return { status: "error", output: guard.reason }

  return null
}

export const withModeAwareness =
  (base: ToolExecutor): ToolExecutor =>
  async (call) => {
    if (call.name === "cancel") return handleCancelInMode(call)

    const handler = specialHandlers.get(call.name)
    if (handler) return handler(call)

    if (isStepGuarded(call.name)) {
      const guardResult = checkStepGuard(call)
      if (guardResult) return guardResult
    }

    const mode = deriveMode(getAllBlocks())
    const unavailable = checkToolAvailability(call.name, mode)
    if (unavailable) return { status: "error", output: unavailable }

    return base(call)
  }
