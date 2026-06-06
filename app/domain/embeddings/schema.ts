import { z } from "zod"

export const EmbeddingRowSchema = z.object({
  text: z.string(),
  hash: z.string(),
  embedding: z.array(z.number()),
  chunkStart: z.number().int(),
  chunkEnd: z.number().int(),
  language: z.string().optional(),
})

export type EmbeddingRow = z.infer<typeof EmbeddingRowSchema>
