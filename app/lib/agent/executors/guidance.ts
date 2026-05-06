import type { Block } from "../client/blocks"
import type { HandlerResult } from "../types"
import { getAllBlocks, pushBlocks } from "../client/store"
import { fromMarkerBlock, toMarkerBlock } from "../client/markers"
import { postCompactionFloor } from "../compact"
import { getApproachMeta } from "~/lib/modes/approaches"

export interface GuidanceCheck {
  required: string[]
  knownKeys: Set<string>
  presentKeys: Set<string>
}

export interface GuidanceDecision {
  toError: HandlerResult<never> | null
  toPush: string[]
}

export const collectApproachKeys = (blocks: Block[]): Set<string> => {
  const floor = postCompactionFloor(blocks)
  const keys = new Set<string>()
  for (let i = floor; i < blocks.length; i++) {
    const key = fromMarkerBlock(blocks[i])
    if (key) keys.add(key)
  }
  return keys
}

export const formatGuidanceError = (keys: string[]): string => {
  const list = keys.map((k) => `"${k}"`).join(", ")
  return `Error: Loaded first time guidance for ${list}.\nIt has been provided. Review it and try again.\nPrevious successful actions are not affected.`
}

export const evaluateGuidance = (check: GuidanceCheck): GuidanceDecision => {
  const known = check.required.filter((k) => check.knownKeys.has(k))
  if (known.length === 0) return { toError: null, toPush: [] }

  const missing = known.filter((k) => !check.presentKeys.has(k))
  if (missing.length === 0) return { toError: null, toPush: [] }

  return {
    toError: { status: "error", output: formatGuidanceError(missing), mutations: [] },
    toPush: missing,
  }
}

export const checkGuidance = (required: string[]): HandlerResult<never> | null => {
  if (required.length === 0) return null

  const knownKeys = new Set(getApproachMeta().keys)
  const unknown = required.filter((k) => !knownKeys.has(k))
  if (unknown.length > 0) {
    console.error(`requiresGuidance: unknown approach keys: ${unknown.join(", ")}`)
  }

  const presentKeys = collectApproachKeys(getAllBlocks())
  const decision = evaluateGuidance({ required, knownKeys, presentKeys })

  if (decision.toPush.length > 0) {
    pushBlocks(decision.toPush.map(toMarkerBlock))
  }
  return decision.toError
}
