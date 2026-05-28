import type { Result } from "~/lib/fp/result"
import type { Database } from "~/lib/db/types"
import type { HydeQuery, HybridSearchPlan } from "./semantic"
import type { HydesCache } from "~/domain/search/types"
import type { CorpusDescription } from "~/domain/corpus/types"
import { ok, err } from "~/lib/fp/result"
import { fetchEmbeddingBatch } from "~/lib/embeddings/client"
import { generateHydesForDescription, generateGenericHydes } from "~/lib/corpus/generate-hydes"
import { processPool } from "~/lib/utils/pool"
import { extractSemanticTokens, hasSemanticTokens, validateSql, buildHybridPlan } from "./semantic"

export type ResolvedQuery =
  | { type: "plain"; sql: string }
  | { type: "hybrid"; plan: HybridSearchPlan; hydesCache: HydesCache; descriptionsHash: string }

export type ResolveError =
  | { type: "invalid"; message: string }
  | { type: "not_ready"; message: string }

export interface SemanticContext {
  db: Database
  baseUrl: string
  descriptions: CorpusDescription[]
  descriptionsHash: string
  cachedHydes?: HydesCache
  cachedDescriptionsHash?: string
}

const LANGUAGE_STATS_SQL = `
  SELECT language, COUNT(*) as cnt,
         COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as pct
  FROM files WHERE language IS NOT NULL
  GROUP BY language`

export interface LanguageStatsRow {
  language: string
  cnt: number
  pct: number
}

const SIGNIFICANCE_THRESHOLD = 10

export const filterSignificantLanguages = (
  rows: LanguageStatsRow[],
  threshold = SIGNIFICANCE_THRESHOLD
): string[] => rows.filter((r) => r.pct > threshold).map((r) => r.language)

export const fetchLanguageStats = async (db: Database): Promise<LanguageStatsRow[]> => {
  const result = await db.query<LanguageStatsRow>(LANGUAGE_STATS_SQL)
  if (!result.ok) return []
  return result.value.rows
}

const fetchLanguages = async (db: Database): Promise<string[]> => {
  const rows = await fetchLanguageStats(db)
  return filterSignificantLanguages(rows)
}

const toHydeQueries = (language: string, texts: string[], vectors: number[][]): HydeQuery[] =>
  texts.map((text, i) => ({ text, language, cosineVector: vectors[i] }))

const invalid = (message: string): Result<ResolvedQuery, ResolveError> =>
  err({ type: "invalid", message })

const notReady = (message: string): Result<ResolvedQuery, ResolveError> =>
  err({ type: "not_ready", message })

const isCacheValid = (ctx: SemanticContext, languages: string[]): boolean => {
  if (!ctx.cachedHydes) return false
  if (ctx.cachedDescriptionsHash !== ctx.descriptionsHash) return false
  const cachedLanguages = Object.keys(ctx.cachedHydes)
  if (cachedLanguages.length !== languages.length) return false
  const langSet = new Set(languages)
  return cachedLanguages.every((l) => langSet.has(l))
}

type HydeTask = () => Promise<HydeResult[]>

interface HydeResult {
  language: string
  texts: string[]
}

const filterDescriptionsForLanguages = (
  descriptions: CorpusDescription[],
  languages: string[]
): CorpusDescription[] => {
  const langSet = new Set(languages)
  return descriptions.filter((d) => langSet.has(d.language))
}

const resolveHydesForLanguages = async (
  descriptions: CorpusDescription[],
  languages: string[],
  query: string,
  ctx: SemanticContext
): Promise<Result<HydesCache, { message: string }>> => {
  if (isCacheValid(ctx, languages)) return ok(ctx.cachedHydes as HydesCache)

  const relevant = filterDescriptionsForLanguages(descriptions, languages)

  const descriptionTasks: HydeTask[] = relevant.map((d) => async () => {
    const texts = await generateHydesForDescription(d, query)
    return texts.map((t) => ({ language: d.language, texts: [t] }))
  })

  const genericTasks: HydeTask[] = languages.map((language) => async () => {
    const texts = await generateGenericHydes(language, query)
    return texts.map((t) => ({ language, texts: [t] }))
  })

  const cache: HydesCache = {}
  for (const lang of languages) cache[lang] = []

  await processPool(
    [...descriptionTasks, ...genericTasks],
    (task) => task(),
    (results: HydeResult[]) => {
      for (const r of results) cache[r.language].push(...r.texts)
    },
    { warmup: 1 }
  )

  return ok(cache)
}

const embedAndFlattenAll = async (
  cache: HydesCache,
  baseUrl: string
): Promise<Result<HydeQuery[], { message: string }>> => {
  const allQueries: HydeQuery[] = []

  for (const [language, texts] of Object.entries(cache)) {
    if (texts.length === 0) continue
    const embeddingResult = await fetchEmbeddingBatch(texts, baseUrl)
    if (!embeddingResult.ok) return err(embeddingResult.error)
    allQueries.push(...toHydeQueries(language, texts, embeddingResult.value))
  }

  return ok(allQueries)
}

export const resolveSemanticSql = async (
  sql: string,
  ctx: SemanticContext
): Promise<Result<ResolvedQuery, ResolveError>> => {
  const validation = validateSql(sql)
  if (!validation.ok) return invalid(validation.error)

  if (!hasSemanticTokens(sql)) return ok({ type: "plain", sql })

  const tokens = extractSemanticTokens(sql)
  const token = tokens[0]

  const languages = await fetchLanguages(ctx.db)
  if (languages.length === 0)
    return notReady("No languages detected in corpus. Embeddings may still be syncing.")

  const hydesResult = await resolveHydesForLanguages(ctx.descriptions, languages, token.text, ctx)
  if (!hydesResult.ok) return invalid(hydesResult.error.message)

  const embedded = await embedAndFlattenAll(hydesResult.value, ctx.baseUrl)
  if (!embedded.ok) return invalid(embedded.error.message)

  const plan = buildHybridPlan(sql, token, embedded.value)
  return ok({
    type: "hybrid",
    plan,
    hydesCache: hydesResult.value,
    descriptionsHash: ctx.descriptionsHash,
  })
}
