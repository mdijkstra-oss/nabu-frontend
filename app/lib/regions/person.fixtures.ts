import type { FindCall, FindWork, Hit, MarkCall, MarkWork } from "./detect/types"
import type { KindDescriptor } from "./kinds/registry"

export const personKind: KindDescriptor = {
  id: "person",
  rules: "fixture rules: a person owns the words of their own turn",
  icon: "user",
  color: "indigo",
  valueType: "string",
}

export const SPEAKER_NAMES = ["Rutte", "Kaag"]

export const turn = (i: number): string =>
  `${SPEAKER_NAMES[i % 2]} spoke about item number ${i}. The room considered point ${i} at some length.`

export const transcript = (turns: number): string =>
  Array.from({ length: turns }, (_, i) => turn(i)).join("\n\n")

export const hitsIn = (item: FindWork): Hit[] =>
  item.sentences.flatMap((text, i) =>
    SPEAKER_NAMES.filter((name) => text.includes(name)).map((name) => ({
      kind: personKind.id,
      quote: name,
      hitSentence: item.unit.firstSentence + i,
      value: name.toLowerCase(),
    }))
  )

interface DetectRecorders {
  onFind?: (items: FindWork[]) => void
  onMark?: (items: MarkWork[]) => void
}

export const answeringDetect = (recorders: DetectRecorders = {}) => {
  const find: FindCall = (items, job) => {
    recorders.onFind?.(items)
    for (const item of items) job.onAnswered(item, hitsIn(item))
    return Promise.resolve({ unrecorded: [] })
  }
  const mark: MarkCall = (items, job) => {
    recorders.onMark?.(items)
    for (const item of items) {
      job.onAnswered(item, {
        ...item.hit,
        startSentence: item.hit.hitSentence,
        endSentence: Math.min(item.hit.hitSentence + 1, item.window.end),
      })
    }
    return Promise.resolve()
  }
  return { find, mark }
}
