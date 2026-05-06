import type { Block, SystemBlock, EmptyNudgeBlock } from "../client/blocks"

type NudgeContext = string | { text: string; blocks: Block[] }

export interface NudgeBlock {
  type: "system" | "empty"
  content: string
  context?: () => Promise<NudgeContext>
}

export type Nudger = (history: Block[]) => NudgeBlock | null

type MultiNudger = (history: Block[]) => Promise<Block[]>

export const systemNudge = (content: string): NudgeBlock => ({ type: "system", content })

export const emptyNudge = (): NudgeBlock => ({ type: "empty", content: "" })

export const isEmptyNudgeBlock = (b: Block): b is EmptyNudgeBlock => b.type === "empty_nudge"

const toSystemBlock = (content: string): SystemBlock => ({ type: "system", content })

const toEmptyNudgeBlock = (): EmptyNudgeBlock => ({ type: "empty_nudge" })

const isStructuredContext = (ctx: NudgeContext): ctx is { text: string; blocks: Block[] } =>
  typeof ctx === "object" && "text" in ctx

const resolveNudge = async (nudge: NudgeBlock): Promise<Block[]> => {
  if (!nudge.context) {
    const block = nudge.type === "empty" ? toEmptyNudgeBlock() : toSystemBlock(nudge.content)
    return [block]
  }

  try {
    const ctx = await nudge.context()
    if (isStructuredContext(ctx)) {
      const resolved = nudge.content.replace("{context}", ctx.text)
      return [toSystemBlock(resolved), ...ctx.blocks]
    }
    const resolved = nudge.content.replace("{context}", ctx)
    return [toSystemBlock(resolved)]
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return [toSystemBlock(`[nudge context error] ${msg}`)]
  }
}

const filterNonNull = <T>(results: (T | null)[]): T[] => results.filter((r): r is T => r !== null)

const isSystem = (block: Block): block is SystemBlock => block.type === "system"

const isActionBlock = (block: Block): boolean =>
  block.type === "tool_call" ||
  block.type === "tool_result" ||
  block.type === "user" ||
  block.type === "text"

const blocksSinceMarker = (history: Block[], marker: string): number => {
  let actions = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const block = history[i]
    if (isSystem(block) && block.content.includes(marker)) return actions
    if (isActionBlock(block)) actions++
  }
  return -1
}

export const isToolResult = (block: Block, name: string): boolean =>
  block.type === "tool_result" && (block as { toolName?: string }).toolName === name

export const isLastToolResult = (history: Block[], name: string): boolean =>
  history.length > 0 && isToolResult(history[history.length - 1], name)

export const afterToolResult = (history: Block[]): boolean =>
  history.length > 0 && history[history.length - 1].type === "tool_result"

type ToolResultStatus = "ok" | "partial" | "error" | null

export const lastToolResultStatus = (history: Block[]): ToolResultStatus => {
  if (history.length === 0) return null
  const last = history[history.length - 1]
  if (last.type !== "tool_result") return null
  const result = last.result as { status?: string } | undefined
  if (!result || typeof result.status !== "string") return null
  if (result.status === "ok" || result.status === "partial" || result.status === "error") {
    return result.status
  }
  return null
}

export const alreadyFired = (history: Block[], marker: string): boolean =>
  blocksSinceMarker(history, marker) !== -1

const firedWithin = (history: Block[], marker: string, n: number): boolean => {
  const since = blocksSinceMarker(history, marker)
  if (since === -1) return false
  return since <= n
}

export const combine =
  (...nudgers: Nudger[]): Nudger =>
  (history) => {
    for (const nudger of nudgers) {
      const result = nudger(history)
      if (result !== null) return result
    }
    return null
  }

export const collect =
  (...nudgers: Nudger[]): MultiNudger =>
  async (history) => {
    const results = filterNonNull(nudgers.map((n) => n(history)))
    const resolved = await Promise.all(results.map(resolveNudge))
    return resolved.flat()
  }

const getNudgeMarker = (nudge: NudgeBlock): string => nudge.content

export const withCooldown =
  (n: number, nudger: Nudger): Nudger =>
  (history) => {
    const result = nudger(history)
    if (result === null) return null
    if (firedWithin(history, getNudgeMarker(result), n)) return null
    return result
  }

export const findToolCallArgs = (
  history: Block[],
  callId: string
): Record<string, unknown> | null => {
  for (let i = history.length - 1; i >= 0; i--) {
    const block = history[i]
    if (block.type === "tool_call") {
      const call = block.calls.find((c) => c.id === callId)
      if (call) return call.args
    }
  }
  return null
}
