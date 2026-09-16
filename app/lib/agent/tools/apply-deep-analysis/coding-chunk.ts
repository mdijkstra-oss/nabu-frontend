import type { Target } from "./def"
import { chunkFileForEmbedding } from "~/lib/embeddings/chunk"
import { indexFileSentences, proseOf } from "~/lib/text/halo"
import { lineToCharOffset } from "~/lib/text/lines"

export interface CodingSentence {
  start: number
  end: number
  text: string
}

export interface CodingChunk {
  id: string
  file: string
  hash: string
  chunkStart: number
  chunkEnd: number
  text: string
  sentences: CodingSentence[]
  score?: number
}

const targetRange = (target: Target, content: string): { start: number; end: number } => {
  const prose = proseOf(content)
  return {
    start: lineToCharOffset(prose, (target.start_line ?? 1) - 1),
    end:
      target.end_line === undefined
        ? prose.length
        : lineToCharOffset(prose, Math.min(target.end_line, prose.split("\n").length)),
  }
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean =>
  a.start < b.end && b.start < a.end

export const buildCodingChunks = (
  targets: readonly Target[],
  resolve: (path: string) => string | undefined
): CodingChunk[] => {
  const rangesByFile = new Map<string, { start: number; end: number }[]>()
  for (const target of targets) {
    const content = resolve(target.path)
    if (content === undefined) continue
    const ranges = rangesByFile.get(target.path) ?? []
    ranges.push(targetRange(target, content))
    rangesByFile.set(target.path, ranges)
  }

  const chunks: CodingChunk[] = []
  for (const [file, ranges] of rangesByFile) {
    const content = resolve(file)
    if (content === undefined) continue
    const rows = indexFileSentences(content)
    for (const chunk of chunkFileForEmbedding(content)) {
      if (
        !ranges.some((range) => overlaps(range, { start: chunk.chunkStart, end: chunk.chunkEnd }))
      )
        continue
      const sentences = rows.flatMap<CodingSentence>((row) =>
        row.start < chunk.chunkEnd && chunk.chunkStart < row.end
          ? [{ start: row.start, end: row.end, text: row.text }]
          : []
      )
      if (sentences.length === 0) continue
      chunks.push({
        id: `${file}:${chunk.chunkStart}:${chunk.hash}`,
        file,
        hash: chunk.hash,
        chunkStart: chunk.chunkStart,
        chunkEnd: chunk.chunkEnd,
        text: chunk.text,
        sentences,
      })
    }
  }
  return chunks
}

export const withScore = (chunk: CodingChunk, score: number | undefined): CodingChunk =>
  score === undefined ? chunk : { ...chunk, score }

// A coder addresses a chunk's sentences by 1-based inclusive position within that
// chunk, never by their position in the file. These two are the only places that
// conversion happens.
export const sentencesInRange = (
  chunk: CodingChunk,
  start: number,
  end: number
): CodingSentence[] => chunk.sentences.slice(start - 1, end)

export const rangeCoveringChars = (
  chunk: CodingChunk,
  charStart: number,
  charEnd: number
): { start: number; end: number } | null => {
  const covered = chunk.sentences.flatMap((sentence, position) =>
    sentence.start < charEnd && charStart < sentence.end ? [position + 1] : []
  )
  return covered.length === 0 ? null : { start: covered[0], end: covered[covered.length - 1] }
}
