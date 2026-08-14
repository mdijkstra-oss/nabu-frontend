import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { indexProseSentences, type SentenceRow } from "~/lib/text/halo"
import { getEmbeddableSource, sliceSource } from "./source"

const toChunkHit = (hit: SearchHit, rows: SentenceRow[], source: string): SearchHit => {
  if (hit.startSentence === undefined || hit.endSentence === undefined) return hit
  const first = rows[hit.startSentence]
  const last = rows[hit.endSentence]
  if (!first || !last || first.start >= last.end) return hit
  return {
    ...hit,
    chunkStart: first.start,
    chunkEnd: last.end,
    text: sliceSource(source, first.start, last.end),
  }
}

export const resolveSentenceHits = (hits: SearchHit[], files: FileStore): SearchHit[] => {
  const sentenceCache = new Map<string, SentenceRow[]>()

  const sentencesOf = (source: string): SentenceRow[] => {
    const cached = sentenceCache.get(source)
    if (cached !== undefined) return cached
    const rows = indexProseSentences(source)
    sentenceCache.set(source, rows)
    return rows
  }

  return hits.map((hit) => {
    if (hit.chunkStart !== undefined || hit.chunkEnd !== undefined) return hit
    const source = getEmbeddableSource(hit.file, files)
    if (source === null) return hit
    return toChunkHit(hit, sentencesOf(source), source)
  })
}
