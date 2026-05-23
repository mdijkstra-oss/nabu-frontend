import { parseCodeBlocks, isLineInsideBlock } from "./parse"

export interface LineRange {
  startLine: number
  endLine: number
}

export interface StrippedContent {
  content: string
  lineMap: number[]
}

const buildIdentityMap = (lineCount: number): number[] =>
  Array.from({ length: lineCount }, (_, i) => i + 1)

export const stripCodeBlockLines = (content: string): StrippedContent => {
  const blocks = parseCodeBlocks(content)
  const lines = content.split("\n")

  if (blocks.length === 0) {
    return { content, lineMap: buildIdentityMap(lines.length) }
  }

  const kept: string[] = []
  const lineMap: number[] = []
  let offset = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineStart = offset
    const lineEnd = offset + line.length

    if (!isLineInsideBlock(blocks, lineStart, lineEnd)) {
      kept.push(line)
      lineMap.push(i + 1)
    }

    offset = lineEnd + 1
  }

  return { content: kept.join("\n"), lineMap }
}

const collectOriginalLines = (lineMap: number[], range: LineRange): number[] => {
  const result: number[] = []
  for (let i = range.startLine - 1; i < range.endLine && i < lineMap.length; i++) {
    result.push(lineMap[i])
  }
  return result
}

const groupIntoContiguousRanges = (lines: number[]): LineRange[] => {
  if (lines.length === 0) return []

  const ranges: LineRange[] = []
  let start = lines[0]
  let end = lines[0]

  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === end + 1) {
      end = lines[i]
    } else {
      ranges.push({ startLine: start, endLine: end })
      start = lines[i]
      end = lines[i]
    }
  }

  ranges.push({ startLine: start, endLine: end })
  return ranges
}

export const remapRanges = (lineMap: number[], ranges: LineRange[]): LineRange[] =>
  ranges.flatMap((range) => groupIntoContiguousRanges(collectOriginalLines(lineMap, range)))
