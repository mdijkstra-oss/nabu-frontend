import { splitSentences } from "./split"

const ELLIPSIS = " … "
const DEFAULT_MAX_CHARS = 200
const WORD_BOUNDARY_BACKOFF = 20

const isSpace = (ch: string): boolean => /\s/.test(ch)

const findHeadBoundary = (text: string, budget: number): number => {
  const limit = Math.min(budget, text.length)
  const floor = Math.max(0, limit - WORD_BOUNDARY_BACKOFF)
  for (let i = limit; i > floor; i--) {
    if (isSpace(text[i])) return i
  }
  return limit
}

const findTailBoundary = (text: string, budget: number): number => {
  const start = Math.max(0, text.length - budget)
  const ceiling = Math.min(text.length, start + WORD_BOUNDARY_BACKOFF)
  for (let i = start; i < ceiling; i++) {
    if (isSpace(text[i])) return i + 1
  }
  return start
}

const takeHead = (text: string, sentences: string[], budget: number): string => {
  let acc = ""
  for (const s of sentences) {
    const next = acc.length === 0 ? s : acc + " " + s
    if (next.length > budget) {
      if (acc.length > 0) return acc
      return text.slice(0, findHeadBoundary(text, budget)).trimEnd()
    }
    acc = next
  }
  return acc
}

const takeTail = (text: string, sentences: string[], budget: number): string => {
  let acc = ""
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i]
    const next = acc.length === 0 ? s : s + " " + acc
    if (next.length > budget) {
      if (acc.length > 0) return acc
      return text.slice(findTailBoundary(text, budget)).trimStart()
    }
    acc = next
  }
  return acc
}

export const summarizeMiddle = (text: string, maxChars = DEFAULT_MAX_CHARS): string => {
  if (text.length <= maxChars) return text
  const sentences = splitSentences(text)
  const innerBudget = maxChars - ELLIPSIS.length
  const headBudget = Math.floor(innerBudget / 2)
  const tailBudget = innerBudget - headBudget
  const head = takeHead(text, sentences, headBudget)
  const tail = takeTail(text, sentences, tailBudget)
  if (head.length + ELLIPSIS.length + tail.length >= text.length) return text
  return head + ELLIPSIS + tail
}
