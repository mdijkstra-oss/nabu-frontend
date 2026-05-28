import { hashChunk } from "./hash"
import { TARGET_CHUNK_SIZE, MIN_CHUNK_SIZE, CHUNK_OVERLAP_RATIO } from "./constants"
import { splitByParagraphs, splitBySentences } from "~/lib/text/split"
import { chunk as chunkSegments } from "~/lib/text/chunk"
import type { Segment } from "~/lib/text/types"

export interface Chunk {
  index: number
  text: string
  hash: string
}

const isHeading = (text: string): boolean => text.trimStart().startsWith("#")

const splitSentenceSegments = splitBySentences()

const offsetSegment = (seg: Segment, base: number): Segment => ({
  text: seg.text,
  start: base + seg.start,
  end: base + seg.end,
})

const refineParagraph = (paragraph: Segment): Segment[] => {
  if (paragraph.text.length <= TARGET_CHUNK_SIZE) return [paragraph]
  const sentences = splitSentenceSegments(paragraph.text)
  if (sentences.length <= 1) return [paragraph]
  return sentences.map((s) => offsetSegment(s, paragraph.start))
}

const wordBoundarySlice = (text: string, targetLen: number): string => {
  const start = text.length - targetLen
  const spaceIdx = text.indexOf(" ", start)
  const breakAt = spaceIdx !== -1 && spaceIdx - start < targetLen * 0.2 ? spaceIdx + 1 : start
  return text.slice(breakAt)
}

const tailSlice = (text: string, ratio: number): string => {
  const targetLen = Math.floor(text.length * ratio)
  if (targetLen === 0) return ""

  const sentences = splitSentenceSegments(text)
  if (sentences.length === 0) return ""

  let startIdx = sentences.length - 1
  for (let i = sentences.length - 2; i >= 0; i--) {
    if (text.length - sentences[i].start > targetLen) break
    startIdx = i
  }

  const slice = text.slice(sentences[startIdx].start)
  if (slice.length > targetLen) return wordBoundarySlice(text, targetLen)
  return slice
}

const addOverlap = (chunks: string[], ratio: number): string[] =>
  chunks.map((c, i) => {
    if (i === 0) return c
    const overlap = tailSlice(chunks[i - 1], ratio)
    return overlap ? overlap + "\n\n" + c : c
  })

export const chunkText = (text: string): Chunk[] => {
  const paragraphs = splitByParagraphs(text)
  if (paragraphs.length === 0) return []

  const segments = paragraphs.flatMap(refineParagraph)

  const textChunks = chunkSegments(segments, {
    target: TARGET_CHUNK_SIZE,
    min: MIN_CHUNK_SIZE,
    maxSegment: TARGET_CHUNK_SIZE * 2,
    breakBefore: (s) => isHeading(s.text),
  })

  const texts = textChunks.map((c) => text.slice(c.start, c.end).trim())
  const overlapped = addOverlap(texts, CHUNK_OVERLAP_RATIO)

  return overlapped.map((t, index) => ({
    index,
    text: t,
    hash: hashChunk(t),
  }))
}
