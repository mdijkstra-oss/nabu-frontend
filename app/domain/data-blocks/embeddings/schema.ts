import { z } from "zod"
import type { ValidationContext } from "~/lib/data-blocks/definition"

const BaseEmbeddingEntry = z.object({
  hash: z.string(),
  text: z.string(),
  embedding: z.array(z.number()),
  chunkStart: z.number().int(),
  chunkEnd: z.number().int(),
  language: z.string().optional(),
})

export const embeddingEntrySchema = (_ctx?: ValidationContext) => BaseEmbeddingEntry

export const EmbeddingEntrySchema = embeddingEntrySchema()
export type EmbeddingEntry = z.infer<typeof EmbeddingEntrySchema>
