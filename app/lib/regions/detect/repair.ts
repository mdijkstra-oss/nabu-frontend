export interface RepairTarget {
  hitSentence: number
  windowStart: number
  windowEnd: number
}

export interface ReportedRange {
  start: number
  end: number
}

export interface RepairedRange {
  startSentence: number
  endSentence: number
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

export const repairRange = (target: RepairTarget, reported: ReportedRange): RepairedRange => {
  const start = clamp(reported.start, target.windowStart, target.windowEnd)
  const end = clamp(reported.end, target.windowStart, target.windowEnd)
  const collapsed =
    end < start ? { start: target.hitSentence, end: target.hitSentence } : { start, end }

  return {
    startSentence: Math.min(collapsed.start, target.hitSentence),
    endSentence: Math.max(collapsed.end, target.hitSentence),
  }
}
