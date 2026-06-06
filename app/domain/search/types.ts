import { z } from "zod"
import { validateSql } from "~/lib/search/semantic"
import { HydeAngleSchema } from "~/lib/corpus/hyde-schema"

export const SearchHitSchema = z.object({
  file: z.string(),
  id: z.string().optional(),
  text: z.string().optional(),
  score: z.number().optional(),
  constituentScores: z.array(z.number()).optional(),
  splitIndex: z.number().int().optional(),
  splitTotal: z.number().int().optional(),
  matches: z.array(z.string()).optional(),
  matchRanges: z.array(z.object({ start: z.number().int(), end: z.number().int() })).optional(),
  chunkStart: z.number().int().optional(),
  chunkEnd: z.number().int().optional(),
})

export type SearchHit = z.infer<typeof SearchHitSchema>

const validSql = z.string().superRefine((sql, ctx) => {
  const result = validateSql(sql)
  if (!result.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error })
})

export const InclusionsSchema = z.record(z.string(), z.array(HydeAngleSchema))

export type Inclusions = z.infer<typeof InclusionsSchema>

export const EmbeddingsSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("corpus"), hash: z.string() }),
  z.object({ type: z.literal("file"), filename: z.string(), hash: z.string() }),
])

export type EmbeddingsSource = z.infer<typeof EmbeddingsSourceSchema>

export const EmbeddingsCacheSchema = z.object({
  source: EmbeddingsSourceSchema,
  inclusions: InclusionsSchema,
})

export type EmbeddingsCache = z.infer<typeof EmbeddingsCacheSchema>

export const SearchEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  highlight: z.string().default(""),
  saved: z.boolean(),
  createdAt: z.number(),
  sql: validSql,
  embeddings: EmbeddingsCacheSchema.optional(),
  meta: z.record(z.string(), z.string()).optional(),
})

export type SearchEntry = z.infer<typeof SearchEntrySchema>

export interface NewSearchData {
  title: string
  description: string
  highlight?: string
  sql: string
  embeddings?: EmbeddingsCache
  meta?: Record<string, string>
}
