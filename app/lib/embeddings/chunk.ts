import { hashChunk } from "./hash"
import { applyOverlap } from "~/lib/cutting/overlap"
import { cutUnits } from "~/lib/cutting/units"
import { indexProseSentences, proseOf } from "~/lib/text/halo"

export interface Chunk {
  index: number
  text: string
  hash: string
  chunkStart: number
  chunkEnd: number
}

// The ONLY way to turn a file's raw markdown into embedding chunks. Embedding
// source is proseOf(content) — never the raw file, never a file *view*.
// Hashes and offsets only line up across the system (sync, search, deep-analysis
// find) because every producer goes through here.
export const chunkFileForEmbedding = (content: string): Chunk[] => {
  const prose = proseOf(content)
  const rows = indexProseSentences(prose)
  return applyOverlap(rows, cutUnits(prose, rows)).map((span, index) => {
    const text = prose.slice(span.chunkStart, span.chunkEnd)
    return {
      index,
      text,
      hash: hashChunk(text),
      chunkStart: span.chunkStart,
      chunkEnd: span.chunkEnd,
    }
  })
}
