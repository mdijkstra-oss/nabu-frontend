import { hashChunk } from "./hash"
import { CHUNK_CHARS, CHUNK_STRIDE_CHARS, CHUNK_WORD_TOLERANCE } from "./constants"

export interface Chunk {
  index: number
  text: string
  hash: string
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

const sliceWindows = (text: string): string[] => {
  if (text.length <= CHUNK_CHARS) return [text]
  const windows: string[] = []
  for (let nominal = 0; nominal < text.length; nominal += CHUNK_STRIDE_CHARS) {
    const start = adjustStart(text, nominal, CHUNK_WORD_TOLERANCE)
    const nominalEnd = Math.min(nominal + CHUNK_CHARS, text.length)
    const end = adjustEnd(text, nominalEnd, CHUNK_WORD_TOLERANCE)
    windows.push(text.slice(start, end))
    if (nominalEnd === text.length) break
  }
  return windows
}

export const chunkText = (text: string): Chunk[] => {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  return sliceWindows(trimmed).map((text, index) => ({
    index,
    text,
    hash: hashChunk(text),
  }))
}
