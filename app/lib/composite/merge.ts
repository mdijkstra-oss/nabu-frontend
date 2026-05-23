import type { Segment } from "./pack"
import type { LineChunk } from "~/lib/data-blocks/chunk-lines"

export interface IndexedTextRange {
  index: number
  text: string
  startLine: number
  endLine: number
}

export const paragraphSeparator = (): string => "\n\n"

const isInSameChunk = (chunks: LineChunk[], lineA: number, lineB: number): boolean =>
  chunks.some(
    (c) => lineA >= c.startLine && lineA <= c.endLine && lineB >= c.startLine && lineB <= c.endLine
  )

const groupConsecutiveRuns = <T extends IndexedTextRange>(
  items: T[],
  chunks: LineChunk[]
): T[][] => {
  if (items.length === 0) return []
  const runs: T[][] = [[items[0]]]

  for (let i = 1; i < items.length; i++) {
    const item = items[i]
    const currentRun = runs[runs.length - 1]
    const prev = currentRun[currentRun.length - 1]
    const isConsecutive = item.index === prev.index + 1
    const sameChunk = isInSameChunk(chunks, prev.startLine, item.startLine)
    if (isConsecutive && sameChunk) {
      currentRun.push(item)
    } else {
      runs.push([item])
    }
  }
  return runs
}

const chunkRun = <T extends IndexedTextRange>(
  run: T[],
  path: string,
  maxChars: number
): Segment[] => {
  const segments: Segment[] = []
  let chunk: T[] = []
  let chunkSize = 0

  for (const item of run) {
    const added = chunkSize > 0 ? item.text.length + 2 : item.text.length
    if (chunkSize > 0 && chunkSize + added > maxChars) {
      segments.push({
        path,
        startLine: chunk[0].startLine,
        endLine: chunk[chunk.length - 1].endLine,
        content: chunk.map((c) => c.text).join("\n\n"),
      })
      chunk = []
      chunkSize = 0
    }
    chunk.push(item)
    chunkSize += added
  }

  if (chunk.length > 0) {
    segments.push({
      path,
      startLine: chunk[0].startLine,
      endLine: chunk[chunk.length - 1].endLine,
      content: chunk.map((c) => c.text).join("\n\n"),
    })
  }
  return segments
}

export const mergeAndChunk = <T extends IndexedTextRange>(
  items: T[],
  path: string,
  maxChars: number,
  chunks: LineChunk[]
): Segment[] => groupConsecutiveRuns(items, chunks).flatMap((run) => chunkRun(run, path, maxChars))
