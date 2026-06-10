import { parseCodeBlocks, isLineInsideBlock } from "./parse"
import { CHARS_PER_TOKEN } from "~/lib/text/constants"

export const CHUNK_TARGET_TOKENS = 5_000
export const CHUNK_TARGET_CHARS = CHUNK_TARGET_TOKENS * CHARS_PER_TOKEN

export const CONTEXT_OVERLAP_TOKENS = 800
export const CONTEXT_OVERLAP_CHARS = CONTEXT_OVERLAP_TOKENS * CHARS_PER_TOKEN

export interface LineChunk {
  startLine: number
  endLine: number
}

interface Acc {
  chunks: LineChunk[]
  start: number
  size: number
}

const flush = (acc: Acc, endLine: number): Acc => ({
  chunks: [...acc.chunks, { startLine: acc.start, endLine }],
  start: endLine + 1,
  size: 0,
})

export const extractLines = (content: string, startLine: number, endLine: number): string =>
  content
    .split("\n")
    .slice(startLine - 1, endLine)
    .join("\n")

export const chunkLines = (content: string, targetSize: number): LineChunk[] => {
  if (!content.trim()) return []

  const blocks = parseCodeBlocks(content)
  const lines = content.split("\n")

  let acc: Acc = { chunks: [], start: 1, size: 0 }
  let offset = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    const lineStart = offset
    const lineEnd = offset + line.length
    const inBlock = isLineInsideBlock(blocks, lineStart, lineEnd)

    if (!inBlock) {
      acc = { ...acc, size: acc.size + line.length }
    }

    if (acc.size >= targetSize && lineNum < lines.length) {
      acc = flush(acc, lineNum)
    }

    offset = lineEnd + 1
  }

  if (acc.start <= lines.length) {
    const isTinyTail = acc.chunks.length > 0 && acc.size < targetSize / 2
    if (isTinyTail) {
      const prev = acc.chunks[acc.chunks.length - 1]
      acc = {
        ...acc,
        chunks: [...acc.chunks.slice(0, -1), { startLine: prev.startLine, endLine: lines.length }],
      }
    } else {
      acc = flush(acc, lines.length)
    }
  }

  return acc.chunks
}
