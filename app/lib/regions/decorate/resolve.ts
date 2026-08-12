import { getBlockUndecorated } from "~/lib/data-blocks/query"
import { extractProse, parseCodeBlocks } from "~/lib/data-blocks/parse"
import { stripMarkdown } from "~/lib/text/strip"
import { indexFileSentences, proseOf, type SentenceRow } from "~/lib/text/halo"
import { createCappedCache } from "~/lib/utils/cache"
import { RegionsBlockSchema, type RegionRow } from "~/domain/data-blocks/regions/schema"

export const REGIONS_LANGUAGE = "json-regions"

export interface DecoratedBlock {
  parsed: unknown
  value: unknown
}

export interface DocumentRegions {
  regions: RegionRow[]
  sentences: SentenceRow[]
  prose: string
  // Where each block sits on the prose axis, keyed by its raw start offset. Built here
  // rather than per read, so every block is placed against one derivation of the document.
  anchors: Map<number, number>
  decorated: Map<number, DecoratedBlock>
}

const readRegions = (raw: string): RegionRow[] =>
  getBlockUndecorated(raw, REGIONS_LANGUAGE, RegionsBlockSchema)?.regions ?? []

const anchorBlocks = (raw: string): Map<number, number> =>
  new Map(
    parseCodeBlocks(raw).map((block) => [
      block.start,
      stripMarkdown(extractProse(raw.slice(0, block.start)), { keepHeadings: true }).length,
    ])
  )

const EMPTY = (): DocumentRegions => ({
  regions: [],
  sentences: [],
  prose: "",
  anchors: new Map(),
  decorated: new Map(),
})

const resolve = (raw: string): DocumentRegions => {
  const regions = readRegions(raw)
  if (regions.length === 0) return EMPTY()
  return {
    regions,
    sentences: indexFileSentences(raw),
    prose: proseOf(raw),
    anchors: anchorBlocks(raw),
    decorated: new Map(),
  }
}

const memo = createCappedCache<string, DocumentRegions>(1000)

export const resolveDocumentRegions = (raw: string): DocumentRegions => {
  const cached = memo.get(raw)
  if (cached) return cached

  const resolved = resolve(raw)
  memo.set(raw, resolved)
  return resolved
}
