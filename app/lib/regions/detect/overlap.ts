import type { Hit, Mark, OverlapResolution } from "./types"
import { groupByKind } from "./group"

const byStartThenHit = (a: Mark, b: Mark): number =>
  a.startSentence - b.startSentence || a.hitSentence - b.hitSentence

const rangeOf = (mark: Mark): string => `${mark.startSentence}-${mark.endSentence}`

const toHit = ({ kind, quote, hitSentence, value }: Mark): Hit => ({
  kind,
  quote,
  hitSentence,
  value,
})

const collapseIdenticalRanges = (sorted: Mark[]): OverlapResolution => {
  const kept = new Map<string, Mark>()
  const unranged: Hit[] = []

  for (const mark of sorted) {
    if (kept.has(rangeOf(mark))) unranged.push(toHit(mark))
    else kept.set(rangeOf(mark), mark)
  }

  return { marks: [...kept.values()], unranged }
}

const cutAtBoundary = (marks: Mark[]): Mark[] => {
  const out = [...marks]

  for (let i = 0; i < out.length - 1; i++) {
    const earlier = out[i]
    const later = out[i + 1]
    if (earlier.endSentence < later.startSentence) continue

    if (later.startSentence - 1 >= earlier.startSentence) {
      out[i] = { ...earlier, endSentence: later.startSentence - 1 }
      continue
    }

    // A stored mark may carry a hit outside its own range — trailing attribution is
    // exactly that — so the sentence after it is not guaranteed to be inside the range
    // being cut, and an unclamped yield writes a row the schema drops on the next read.
    const yieldedStart = Math.min(earlier.hitSentence + 1, later.endSentence)
    out[i + 1] = { ...later, startSentence: yieldedStart }
    out[i] = {
      ...earlier,
      endSentence: Math.max(earlier.startSentence, Math.min(earlier.endSentence, yieldedStart - 1)),
    }
  }

  return out
}

export const resolveOverlaps = (marks: Mark[]): OverlapResolution =>
  groupByKind(marks).reduce<OverlapResolution>(
    (acc, kindMarks) => {
      const collapsed = collapseIdenticalRanges([...kindMarks].sort(byStartThenHit))
      return {
        marks: [...acc.marks, ...cutAtBoundary(collapsed.marks)],
        unranged: [...acc.unranged, ...collapsed.unranged],
      }
    },
    { marks: [], unranged: [] }
  )
