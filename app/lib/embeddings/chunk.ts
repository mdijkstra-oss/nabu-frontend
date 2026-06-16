import { hashChunk } from "./hash"
import { CHUNK_CHARS, CHUNK_STRIDE_CHARS, CHUNK_WORD_TOLERANCE } from "./constants"
import { splitBySentences } from "~/lib/text/split"
import { extractProse } from "~/lib/data-blocks/parse"
import type { Segment } from "~/lib/text/types"

export interface Chunk {
  index: number
  text: string
  hash: string
  chunkStart: number
  chunkEnd: number
}

interface Window {
  text: string
  start: number
  end: number
}

const isWhitespace = (ch: string): boolean => /\s/.test(ch)

const findWhitespaceBackward = (text: string, pos: number, tolerance: number): number | null => {
  const lo = Math.max(0, pos - tolerance)
  for (let i = pos - 1; i >= lo; i--) {
    if (isWhitespace(text[i])) return i
  }
  return null
}

const adjustStart = (text: string, nominal: number, tolerance: number): number => {
  if (nominal === 0) return 0
  if (isWhitespace(text[nominal - 1])) return nominal
  const ws = findWhitespaceBackward(text, nominal, tolerance)
  return ws === null ? nominal : ws + 1
}

const adjustEnd = (text: string, nominal: number, tolerance: number): number => {
  if (nominal >= text.length) return text.length
  if (isWhitespace(text[nominal])) return nominal
  const ws = findWhitespaceBackward(text, nominal, tolerance)
  return ws === null ? nominal : ws
}

const sliceWindows = (text: string): Window[] => {
  if (text.length <= CHUNK_CHARS) return [{ text, start: 0, end: text.length }]
  const windows: Window[] = []
  for (let nominal = 0; nominal < text.length; nominal += CHUNK_STRIDE_CHARS) {
    const start = adjustStart(text, nominal, CHUNK_WORD_TOLERANCE)
    const nominalEnd = Math.min(nominal + CHUNK_CHARS, text.length)
    const end = adjustEnd(text, nominalEnd, CHUNK_WORD_TOLERANCE)
    windows.push({ text: text.slice(start, end), start, end })
    if (nominalEnd === text.length) break
  }
  return windows
}

const splitter = splitBySentences()

export const MAX_SNAP_EXTENSION = 300

const snapStartToSentence = (segments: Segment[], offset: number): number => {
  for (const seg of segments) {
    if (offset < seg.start) return seg.start
    if (offset < seg.end) {
      const backDist = offset - seg.start
      return backDist <= MAX_SNAP_EXTENSION ? seg.start : offset
    }
  }
  return offset
}

const snapEndToSentence = (segments: Segment[], offset: number): number => {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    if (offset > seg.end) return seg.end
    if (offset > seg.start) {
      const fwdDist = seg.end - offset
      return fwdDist <= MAX_SNAP_EXTENSION ? seg.end : offset
    }
  }
  return offset
}

const snapWindowsToSentences = (text: string, windows: Window[]): Window[] => {
  const segments = splitter(text)
  if (segments.length === 0) return windows
  return windows.map((w) => {
    const start = snapStartToSentence(segments, w.start)
    const end = snapEndToSentence(segments, w.end)
    if (end <= start) return w
    return { text: text.slice(start, end), start, end }
  })
}

const countLeadingWhitespace = (text: string): number => {
  let i = 0
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}

export const chunkText = (text: string): Chunk[] => {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const leadingTrim = countLeadingWhitespace(text)
  const windows = snapWindowsToSentences(trimmed, sliceWindows(trimmed))
  return windows.map((window, index) => ({
    index,
    text: window.text,
    hash: hashChunk(window.text),
    chunkStart: window.start + leadingTrim,
    chunkEnd: window.end + leadingTrim,
  }))
}

// The ONLY way to turn a file's raw markdown into embedding chunks. Embedding
// source is extractProse(content) — never the raw file, never a file *view*.
// Hashes and offsets only line up across the system (sync, search, deep-analysis
// find) because every producer goes through here. If you need a file's chunks,
// call this — do not pair extractProse + chunkText yourself.
export const chunkFileForEmbedding = (content: string): Chunk[] => chunkText(extractProse(content))
