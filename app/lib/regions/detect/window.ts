import { CHUNK_CHARS } from "~/lib/embeddings/constants"
import type { Hit, SentenceWindow, WindowedHit } from "./types"
import { groupByKind } from "./group"

export const MARK_WINDOW_CHARS = 8 * CHUNK_CHARS

export const sliceWindow = (sentences: string[], window: SentenceWindow): string[] =>
  sentences.slice(window.start, window.end + 1)

const byHitSentence = (a: Hit, b: Hit): number => a.hitSentence - b.hitSentence

const neighbourBound = (sorted: Hit[], index: number, lastSentence: number): SentenceWindow => ({
  start: index === 0 ? 0 : sorted[index - 1].hitSentence,
  end: index === sorted.length - 1 ? lastSentence : sorted[index + 1].hitSentence,
})

const clampToChars = (
  sentences: string[],
  hitSentence: number,
  bound: SentenceWindow
): SentenceWindow => {
  let start = hitSentence
  let end = hitSentence
  let chars = sentences[hitSentence].length
  let growing = true

  while (growing) {
    growing = false
    const left = start > bound.start ? chars + 1 + sentences[start - 1].length : Infinity
    if (left <= MARK_WINDOW_CHARS) {
      chars = left
      start--
      growing = true
    }
    const right = end < bound.end ? chars + 1 + sentences[end + 1].length : Infinity
    if (right <= MARK_WINDOW_CHARS) {
      chars = right
      end++
      growing = true
    }
  }

  return { start, end }
}

// A hit outside the array is not this component's to repair, and it is not this
// component's to crash on either: it can only arrive from stored state a reader was
// told to tolerate.
const locatable = (sentences: string[]) => (hit: Hit) =>
  hit.hitSentence >= 0 && hit.hitSentence < sentences.length

export const computeWindows = (hits: Hit[], sentences: string[]): WindowedHit[] =>
  groupByKind(hits.filter(locatable(sentences))).flatMap((kindHits) => {
    const sorted = [...kindHits].sort(byHitSentence)
    return sorted.map((hit, index) => ({
      hit,
      window: clampToChars(
        sentences,
        hit.hitSentence,
        neighbourBound(sorted, index, sentences.length - 1)
      ),
    }))
  })
