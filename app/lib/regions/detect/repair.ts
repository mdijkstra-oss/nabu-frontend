import { toSentenceIndex } from "./payload"
import type { MarkResult } from "./schema"
import type { MarkInput } from "./types"

export interface RepairedRange {
  startSentence: number
  endSentence: number
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

export const repairRange = (target: MarkInput, reported: MarkResult): RepairedRange => {
  const start = clamp(toSentenceIndex(reported.start), target.windowStart, target.windowEnd)
  const end = clamp(toSentenceIndex(reported.end), target.windowStart, target.windowEnd)
  const collapsed =
    end < start ? { start: target.hitSentence, end: target.hitSentence } : { start, end }

  return {
    startSentence: Math.min(collapsed.start, target.hitSentence),
    endSentence: Math.max(collapsed.end, target.hitSentence),
  }
}
