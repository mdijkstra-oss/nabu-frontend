import type { Result } from "~/lib/fp/result"
import type { Database } from "~/lib/db/types"
import type { HydeQuery, HybridSearchPlan, KeywordsQuery } from "./semantic"
import type { EmbeddingsCache, EmbeddingsSource, Inclusions } from "~/domain/search/types"
import type { CorpusDescription } from "~/domain/corpus/types"
import type { HydeAngle } from "~/lib/corpus/hyde-schema"
import { ok, err } from "~/lib/fp/result"
import { fetchEmbeddingBatch } from "~/lib/embeddings/client"
import { generateHydesForDescription, generateGenericHydes } from "~/lib/corpus/generate-hydes"
import { generateFileHydes } from "~/lib/corpus/generate-file-hydes"
import { getFileRaw } from "~/lib/files/store"
import { resolveHiddenFile } from "~/lib/files/hidden-blocks"
import { parseCodeBlocks, parseBlockJson } from "~/lib/data-blocks/parse"
import { processPool } from "~/lib/utils/pool"
import { isDebugOn } from "~/lib/debug/options"
import {
  extractSemanticTokens,
  hasSemanticTokens,
  extractFileEmbeddingTokens,
  hasFileEmbeddingTokens,
  validateSql,
  buildHybridPlan,
} from "./semantic"

export type ResolvedQuery =
  | { type: "plain"; sql: string }
  | { type: "hybrid"; plan: HybridSearchPlan; embeddings: EmbeddingsCache; highlight?: string }

export type ResolveError =
  | { type: "invalid"; message: string }
  | { type: "not_ready"; message: string }

export interface SemanticContext {
  db: Database
  baseUrl: string
  descriptions: CorpusDescription[]
  descriptionsHash: string
  cachedEmbeddings?: EmbeddingsCache
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

const toHydeQueries = (language: string, angles: HydeAngle[], vectors: number[][]): HydeQuery[] =>
  angles.map((angle, i) => ({
    text: angle.text,
    type: angle.type,
    language,
    cosineVector: vectors[i],
  }))

const invalid = (message: string): Result<ResolvedQuery, ResolveError> =>
  err({ type: "invalid", message })

const notReady = (message: string): Result<ResolvedQuery, ResolveError> =>
  err({ type: "not_ready", message })

const hasMatchingLanguages = (cached: Inclusions, languages: string[]): boolean => {
  const cachedLanguages = Object.keys(cached)
  if (cachedLanguages.length !== languages.length) return false
  const langSet = new Set(languages)
  return cachedLanguages.every((l) => langSet.has(l))
}

const isCorpusCacheValid = (
  cached: EmbeddingsCache | undefined,
  descriptionsHash: string,
  languages: string[]
): boolean => {
  if (!cached) return false
  if (cached.source.type !== "corpus") return false
  if (cached.source.hash !== descriptionsHash) return false
  return hasMatchingLanguages(cached.inclusions, languages)
}

const isFileCacheValid = (
  cached: EmbeddingsCache | undefined,
  fileHash: string,
  languages: string[]
): boolean => {
  if (!cached) return false
  if (cached.source.type !== "file") return false
  if (cached.source.hash !== fileHash) return false
  return hasMatchingLanguages(cached.inclusions, languages)
}

type HydeTask = () => Promise<HydeResult[]>

interface HydeResult {
  language: string
  angles: HydeAngle[]
}

const filterDescriptionsForLanguages = (
  descriptions: CorpusDescription[],
  languages: string[]
): CorpusDescription[] => {
  const langSet = new Set(languages)
  return descriptions.filter((d) => langSet.has(d.language))
}

const buildRawQueryInclusions = (languages: string[], query: string): Inclusions => {
  const inclusions: Inclusions = {}
  for (const lang of languages) inclusions[lang] = [{ type: "direct", text: query }]
  return inclusions
}

const resolveCorpusInclusions = async (
  descriptions: CorpusDescription[],
  languages: string[],
  query: string,
  ctx: SemanticContext
): Promise<Result<Inclusions, { message: string }>> => {
  const cached = ctx.cachedEmbeddings
  if (cached && isCorpusCacheValid(cached, ctx.descriptionsHash, languages))
    return ok(cached.inclusions)

  if (isDebugOn("skipHydeGeneration")) return ok(buildRawQueryInclusions(languages, query))

  const relevant = filterDescriptionsForLanguages(descriptions, languages)

  const descriptionTasks: HydeTask[] = relevant.map((d) => async () => {
    const angles = await generateHydesForDescription(d, query)
    return angles.map((a) => ({ language: d.language, angles: [a] }))
  })

  const genericTasks: HydeTask[] = languages.map((language) => async () => {
    const angles = await generateGenericHydes(language, query)
    return angles.map((a) => ({ language, angles: [a] }))
  })

  const inclusions: Inclusions = {}
  for (const lang of languages) inclusions[lang] = []

  await processPool(
    [...descriptionTasks, ...genericTasks],
    (task) => task(),
    (results: HydeResult[]) => {
      for (const r of results) inclusions[r.language].push(...r.angles)
    },
    { warmup: 1 }
  )

  return ok(inclusions)
}

export const hashString = (input: string): string => {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return hash.toString(36)
}

interface FileHydeResult {
  language: string
  angles: HydeAngle[]
}

const resolveFileInclusions = async (
  filename: string,
  languages: string[],
  fileHash: string,
  fileContent: string,
  ctx: SemanticContext
): Promise<Result<{ inclusions: Inclusions }, { message: string }>> => {
  const cached = ctx.cachedEmbeddings
  if (cached && isFileCacheValid(cached, fileHash, languages))
    return ok({ inclusions: cached.inclusions })

  const inclusions: Inclusions = {}
  for (const lang of languages) inclusions[lang] = []

  type FileHydeTask = () => Promise<FileHydeResult[]>

  const tasks: FileHydeTask[] = languages.map((language) => async () => {
    const response = await generateFileHydes(fileContent, filename, language)
    return [{ language, angles: response.inclusions }]
  })

  await processPool(
    tasks,
    (task) => task(),
    (results: FileHydeResult[]) => {
      for (const r of results) inclusions[r.language].push(...r.angles)
    },
    { warmup: 1 }
  )

  return ok({ inclusions })
}

const isEmbeddable = (angle: HydeAngle): boolean => angle.type !== "keywords"

const isKeyword = (angle: HydeAngle): boolean => angle.type === "keywords"

const extractKeywords = (inclusions: Inclusions): KeywordsQuery[] => {
  const out: KeywordsQuery[] = []
  for (const [language, angles] of Object.entries(inclusions)) {
    const text = angles
      .filter(isKeyword)
      .map((a) => a.text)
      .join(" ")
      .trim()
    if (text.length > 0) out.push({ language, text })
  }
  return out
}

const embedAndFlattenAll = async (
  inclusions: Inclusions,
  baseUrl: string
): Promise<Result<HydeQuery[], { message: string }>> => {
  const entries = Object.entries(inclusions)
    .map(([language, angles]) => [language, angles.filter(isEmbeddable)] as const)
    .filter(([, angles]) => angles.length > 0)
  const allQueries: HydeQuery[] = []

  const pool = await processPool(
    entries,
    async ([language, angles]) => {
      const result = await fetchEmbeddingBatch(
        angles.map((a) => a.text),
        baseUrl
      )
      if (!result.ok) throw new Error(result.error.message)
      return toHydeQueries(language, angles, result.value)
    },
    (hydes) => allQueries.push(...hydes),
    { warmup: 0 }
  )

  if (pool.failures.length > 0) {
    const message =
      pool.failures[0].error instanceof Error
        ? pool.failures[0].error.message
        : String(pool.failures[0].error)
    return err({ message })
  }

  return ok(allQueries)
}

const resolveCorpusSql = async (
  sql: string,
  ctx: SemanticContext
): Promise<Result<ResolvedQuery, ResolveError>> => {
  const tokens = extractSemanticTokens(sql)
  const token = tokens[0]

  const languages = await fetchLanguages(ctx.db)
  if (languages.length === 0)
    return notReady("No languages detected in corpus. Embeddings may still be syncing.")

  const inclusionsResult = await resolveCorpusInclusions(
    ctx.descriptions,
    languages,
    token.text,
    ctx
  )
  if (!inclusionsResult.ok) return invalid(inclusionsResult.error.message)

  const embedded = await embedAndFlattenAll(inclusionsResult.value, ctx.baseUrl)
  if (!embedded.ok) return invalid(embedded.error.message)

  const keywords = extractKeywords(inclusionsResult.value)
  const plan = buildHybridPlan(sql, token, embedded.value, keywords)
  const source: EmbeddingsSource = { type: "corpus", hash: ctx.descriptionsHash }
  return ok({
    type: "hybrid",
    plan,
    embeddings: { source, inclusions: inclusionsResult.value },
  })
}

const readFileContent = (filename: string): string | undefined =>
  resolveHiddenFile(filename) ?? getFileRaw(filename) ?? undefined

const firstSentence = (text: string): string => {
  const trimmed = text.trim()
  const match = trimmed.match(/^(.+?[.!?])(\s|$)/s)
  return (match ? match[1] : trimmed.split(/\r?\n/)[0]).trim()
}

const deriveFileHighlight = (fileContent: string, filename: string): string => {
  const blocks = parseCodeBlocks(fileContent)
  for (const block of blocks) {
    const parsed = parseBlockJson<Record<string, unknown>>(block)
    if (!parsed.ok) continue
    const title = typeof parsed.data.title === "string" ? parsed.data.title : ""
    const content = typeof parsed.data.content === "string" ? parsed.data.content : ""
    const summary = firstSentence(content)
    const joined = [title, summary].filter((s) => s.length > 0).join(" — ")
    if (joined.length > 0) return joined
  }
  return `Passages matching the definition in ${filename}`
}

const resolveFileSql = async (
  sql: string,
  ctx: SemanticContext
): Promise<Result<ResolvedQuery, ResolveError>> => {
  const tokens = extractFileEmbeddingTokens(sql)
  const token = tokens[0]
  const filename = token.text

  const fileContent = readFileContent(filename)
  if (!fileContent) return notReady(`EMBEDDINGS_FROM_FILE: file not yet available — ${filename}`)

  const fileHash = hashString(fileContent)

  const languages = await fetchLanguages(ctx.db)
  if (languages.length === 0)
    return notReady("No languages detected in corpus. Embeddings may still be syncing.")

  try {
    const fileResult = await resolveFileInclusions(filename, languages, fileHash, fileContent, ctx)
    if (!fileResult.ok) return invalid(fileResult.error.message)

    const embedded = await embedAndFlattenAll(fileResult.value.inclusions, ctx.baseUrl)
    if (!embedded.ok) return invalid(embedded.error.message)

    const keywords = extractKeywords(fileResult.value.inclusions)
    const plan = buildHybridPlan(sql, token, embedded.value, keywords)
    const source: EmbeddingsSource = { type: "file", filename, hash: fileHash }
    return ok({
      type: "hybrid",
      plan,
      embeddings: { source, inclusions: fileResult.value.inclusions },
      highlight: deriveFileHighlight(fileContent, filename),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[EMBEDDINGS_FROM_FILE] ${filename}:`, e)
    return invalid(`EMBEDDINGS_FROM_FILE failed for ${filename}: ${message}`)
  }
}

export const resolveSemanticSql = async (
  sql: string,
  ctx: SemanticContext
): Promise<Result<ResolvedQuery, ResolveError>> => {
  const validation = validateSql(sql)
  if (!validation.ok) return invalid(validation.error)

  if (hasFileEmbeddingTokens(sql)) return resolveFileSql(sql, ctx)
  if (hasSemanticTokens(sql)) return resolveCorpusSql(sql, ctx)

  return ok({ type: "plain", sql })
}
