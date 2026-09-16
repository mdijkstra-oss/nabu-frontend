import { rangeCoveringChars, sentencesInRange } from "./coding-chunk"
import type { CoderSelection, CodingCandidate } from "./step-code"
export interface CodingDecision {
  candidate: CodingCandidate
  start: number
  end: number
  reason: string
  findVotes: boolean[]
  review?: string
}

export interface ReconciledCodings {
  accepted: CodingDecision[]
  contested: CoderSelection[]
}

const absoluteBounds = (selection: Pick<CoderSelection, "candidate" | "start" | "end">) => {
  const sentences = sentencesInRange(selection.candidate.chunk, selection.start, selection.end)
  const first = sentences[0]
  const last = sentences[sentences.length - 1]
  return first && last ? { start: first.start, end: last.end } : null
}

const sameCodeOverlap = (a: CoderSelection, b: CoderSelection): boolean => {
  if (a.candidate.code !== b.candidate.code || a.candidate.chunk.file !== b.candidate.chunk.file)
    return false
  const aa = absoluteBounds(a)
  const bb = absoluteBounds(b)
  return aa !== null && bb !== null && aa.start < bb.end && bb.start < aa.end
}

const intersection = (a: CoderSelection, b: CoderSelection): CodingDecision | null => {
  if (!sameCodeOverlap(a, b)) return null
  const aa = absoluteBounds(a)
  const bb = absoluteBounds(b)
  if (!aa || !bb) return null
  const start = Math.max(aa.start, bb.start)
  const end = Math.min(aa.end, bb.end)
  const range = rangeCoveringChars(a.candidate.chunk, start, end)
  if (!range) return null
  return {
    candidate: a.candidate,
    start: range.start,
    end: range.end,
    reason: a.reason,
    findVotes: [true, true],
  }
}

const decisionKey = (decision: CodingDecision): string => {
  const bounds = absoluteBounds(decision)
  return `${decision.candidate.chunk.file}:${bounds?.start ?? -1}:${bounds?.end ?? -1}:${decision.candidate.code}`
}

export const dedupCodingDecisions = (decisions: readonly CodingDecision[]): CodingDecision[] => {
  const seen = new Set<string>()
  return decisions.filter((decision) => {
    const key = decisionKey(decision)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const decisionsFromOneCoder = (selections: readonly CoderSelection[]): CodingDecision[] =>
  dedupCodingDecisions(
    selections.map((selection) => ({
      candidate: selection.candidate,
      start: selection.start,
      end: selection.end,
      reason: selection.reason,
      findVotes: [true],
    }))
  )

export const reconcileCoderSelections = (
  voterOne: readonly CoderSelection[],
  voterTwo: readonly CoderSelection[]
): ReconciledCodings => {
  const accepted: CodingDecision[] = []
  const oneOverlaps = new Set<number>()
  const twoOverlaps = new Set<number>()

  for (let one = 0; one < voterOne.length; one++) {
    for (let two = 0; two < voterTwo.length; two++) {
      const agreed = intersection(voterOne[one], voterTwo[two])
      if (!agreed) continue
      accepted.push(agreed)
      oneOverlaps.add(one)
      twoOverlaps.add(two)
    }
  }

  return {
    accepted: dedupCodingDecisions(accepted),
    contested: [
      ...voterOne.filter((_, index) => !oneOverlaps.has(index)),
      ...voterTwo.filter((_, index) => !twoOverlaps.has(index)),
    ],
  }
}
