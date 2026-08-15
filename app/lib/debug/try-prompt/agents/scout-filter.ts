import { readFileSync } from "node:fs"
import { z } from "zod"
import { filterEntries } from "~/lib/agent/tools/scout-filter/api"
import { assignIds, type Entry } from "~/lib/calls/entry"
import { chunkFileForEmbedding } from "~/lib/embeddings/chunk"
import { buildChunkBlocks, toEntryInput, type ChunkBlock } from "~/lib/search/scout"
import { proseOf } from "~/lib/text/halo"
import { errorMessage } from "~/lib/utils/error"
import { defineAgent, UsageError } from "./types"
import { pathFlag } from "./flags"
import { onlyFileOf } from "./document"

const extras = z.object({
  framework: pathFlag("the analysis framework the filter scopes entries against"),
})

export interface Exclusion {
  entryId: number
  chunkStart: number
}

export const chunkEntriesOf = (file: string, raw: string): Entry<ChunkBlock>[] => {
  const blocks = buildChunkBlocks(proseOf(raw), chunkFileForEmbedding(raw))
  return assignIds(blocks.map((block) => toEntryInput(file, block)))
}

export const scoutFilter = defineAgent({
  name: "scout-filter",
  summary: "ask which chunks of the file fall outside a framework's scope",
  input: "file",
  extras,
  constructedLabel: "exclusions",
  run: async ({ files, extras: { framework } }) => {
    const frameworkText = readFramework(framework)
    const { file, raw } = onlyFileOf(files)
    const entries = chunkEntriesOf(file, raw)
    const excluded = await filterEntries(frameworkText, entries)
    return entries.filter((entry) => excluded.has(entry.id)).map(toExclusion)
  },
})

const toExclusion = (entry: Entry<ChunkBlock>): Exclusion => ({
  entryId: entry.id,
  chunkStart: entry.item.chunkStart,
})

const readFramework = (path: string): string => {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    throw new UsageError(`cannot read --framework ${path}: ${errorMessage(error)}`)
  }
  if (text.trim().length === 0) throw new UsageError(`--framework ${path} is empty`)
  return text
}
