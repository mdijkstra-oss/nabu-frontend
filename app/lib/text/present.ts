import { tokenizeWords } from "./find"

export interface CodedItem {
  start: number
  end: number
  codings: string[]
  reason?: string
  id?: string
  keepCase?: string
  removeCase?: string
}

export interface ItemMapping {
  index: number
  start: number
  end: number
  codings: string[]
}

export interface PresentedSection {
  text: string
  mapping: ItemMapping[]
}

export type VisibleRange = [start: number, end: number]

export const buildVisibleRanges = (
  items: CodedItem[],
  sentenceCount: number,
  context: number
): VisibleRange[] => {
  if (items.length === 0) return [[1, sentenceCount]]

  const expanded: VisibleRange[] = items
    .map(
      (item): VisibleRange => [
        Math.max(1, item.start - context),
        Math.min(sentenceCount, item.end + context),
      ]
    )
    .sort((a, b) => a[0] - b[0])

  const merged: VisibleRange[] = [expanded[0]]
  for (let i = 1; i < expanded.length; i++) {
    const last = merged[merged.length - 1]
    if (expanded[i][0] <= last[1] + 1) {
      last[1] = Math.max(last[1], expanded[i][1])
    } else {
      merged.push(expanded[i])
    }
  }
  return merged
}

const buildVisibleSet = (ranges: VisibleRange[]): Set<number> => {
  const visible = new Set<number>()
  for (const [start, end] of ranges) {
    for (let s = start; s <= end; s++) visible.add(s)
  }
  return visible
}

interface TaggedSegment {
  type: "context" | "annotation" | "ellipsis"
  text: string
  id?: string
  codings?: string[]
}

const flushContext = (buffer: string[], segments: TaggedSegment[]) => {
  if (buffer.length === 0) return
  segments.push({ type: "context", text: buffer.join(" ") })
  buffer.length = 0
}

export const formatTaggedSection = (
  sentences: string[],
  items: CodedItem[],
  context?: number
): string => {
  const itemBySentence = new Map<number, { item: CodedItem; itemIndex: number }[]>()

  let nextIndex = 1
  for (const item of items) {
    const idx = nextIndex++
    for (let s = item.start; s <= item.end; s++) {
      if (!itemBySentence.has(s)) itemBySentence.set(s, [])
      const entries = itemBySentence.get(s) as { item: typeof item; itemIndex: number }[]
      entries.push({ item, itemIndex: idx })
    }
  }

  const visible =
    context !== undefined
      ? buildVisibleSet(buildVisibleRanges(items, sentences.length, context))
      : undefined

  const segments: TaggedSegment[] = []
  const contextBuffer: string[] = []
  const emittedItems = new Set<number>()
  let inGap = false

  for (let s = 1; s <= sentences.length; s++) {
    if (visible && !visible.has(s)) {
      if (!inGap) {
        flushContext(contextBuffer, segments)
        segments.push({ type: "ellipsis", text: "..." })
        inGap = true
      }
      continue
    }
    inGap = false

    const entries = itemBySentence.get(s)
    if (!entries || entries.length === 0) {
      contextBuffer.push(sentences[s - 1])
      continue
    }

    for (const { item, itemIndex } of entries) {
      if (emittedItems.has(itemIndex)) continue
      emittedItems.add(itemIndex)

      flushContext(contextBuffer, segments)
      const spanText = sentences.slice(item.start - 1, item.end).join(" ")
      segments.push({
        type: "annotation",
        text: spanText,
        id: item.id,
        codings: item.codings,
      })
    }
  }
  flushContext(contextBuffer, segments)

  return segments.map(formatSegment).join("\n")
}

const formatAnnotationAttrs = (seg: TaggedSegment): string => {
  const parts: string[] = []
  if (seg.id) parts.push(`id="${seg.id}"`)
  if (seg.codings && seg.codings.length > 0) parts.push(`code="${seg.codings.join(", ")}"`)
  return parts.length > 0 ? ` ${parts.join(" ")}` : ""
}

const formatSegment = (seg: TaggedSegment): string => {
  switch (seg.type) {
    case "context":
      return `<context>${seg.text}</context>`
    case "annotation":
      return `<annotation${formatAnnotationAttrs(seg)}>${seg.text}</annotation>`
    case "ellipsis":
      return seg.text
    default:
      throw new Error(`unknown segment type: ${(seg as TaggedSegment).type}`)
  }
}

const countCoverage = (needleWords: string[], windowWords: string[]): number => {
  let matched = 0
  for (const w of needleWords) {
    if (windowWords.includes(w)) matched++
  }
  return matched
}

const isTighterFit = (
  coverage: number,
  span: number,
  bestCoverage: number,
  bestSpan: number
): boolean => coverage > bestCoverage || (coverage === bestCoverage && span < bestSpan)

export const locateTextInSentences = (
  sentences: string[],
  needle: string,
  threshold = 0.6
): { start: number; end: number } | null => {
  const needleWords = tokenizeWords(needle)
  if (needleWords.length === 0) return null

  const sentenceWordSets = sentences.map(tokenizeWords)

  let bestCoverage = 0
  let bestSpan = Infinity
  let bestStart = -1
  let bestEnd = -1

  for (let start = 0; start < sentences.length; start++) {
    const accumulated: string[] = []
    for (let end = start; end < Math.min(start + needleWords.length + 3, sentences.length); end++) {
      accumulated.push(...sentenceWordSets[end])
      const coverage = countCoverage(needleWords, accumulated)
      const span = end - start + 1
      if (isTighterFit(coverage, span, bestCoverage, bestSpan)) {
        bestCoverage = coverage
        bestSpan = span
        bestStart = start
        bestEnd = end
      }
      if (accumulated.length >= needleWords.length * 2) break
    }
  }

  if (bestCoverage / needleWords.length < threshold) return null
  return { start: bestStart + 1, end: bestEnd + 1 }
}
