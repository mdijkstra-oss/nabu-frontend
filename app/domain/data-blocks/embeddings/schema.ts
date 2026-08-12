import { z } from "zod"
import type { ValidationContext } from "~/lib/data-blocks/definition"

// The one definition of a companion entry. The block is written by the embedding sync and
// read back by the sync, the database projection and the BM25 index, so a reader that
// judged an entry by its own rules would keep feeding the others something they reject.
export const EmbeddingEntrySchema = z.object({
  hash: z.string(),
  text: z.string(),
  embedding: z.array(z.number()),
  chunkStart: z.number().int(),
  chunkEnd: z.number().int(),
  language: z.string().optional(),
})

export const embeddingEntrySchema = (_ctx?: ValidationContext) => EmbeddingEntrySchema

export type EmbeddingEntry = z.infer<typeof EmbeddingEntrySchema>
