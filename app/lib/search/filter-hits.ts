import { z } from "zod"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { callLlm } from "~/lib/agent/client/fetch"
import { extractText, toResponseFormat } from "~/lib/agent/client/convert"
import { buildKey, tryGet, tryPut } from "~/lib/utils/storage-cache"
import { splitBySentences } from "~/lib/text/split"
import { formatNumberedPassage } from "~/lib/text/format"
import { growHits } from "./slices"

export { formatNumberedPassage } from "~/lib/text/format"

export const FILTER_BATCH_SIZE = 10

const SEMANTIC_FILTER_ENDPOINT = "/semantic-filter"
const MIN_WORD_COUNT = 3
const WORD_SPLIT_RE = /\s+/

const hasEnoughWords = (text: string): boolean => text.split(WORD_SPLIT_RE).length >= MIN_WORD_COUNT

const toSystem = (content: string) => ({
  type: "message" as const,
  role: "system" as const,
  content,
})

const FILTER_CALL_TO_ACTION =
  "Return the 1-based sentence numbers that match the intent, grouped into contiguous sequences."

const splitSentenceTexts = splitBySentences()

export const splitSentences = (text: string): string[] =>
  splitSentenceTexts(text).map((s) => s.text)

export const toLetter = (index: number): string => {
  let result = ""
  let n = index
  do {
    result = String.fromCharCode(97 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return result
}

export const reconstructHits = (
  sentences: string[],
  groups: number[][],
  file: string,
  id?: string
): SearchHit[] => {
  const hits: SearchHit[] = []
  for (const indices of groups) {
    const text = indices
      .filter((i) => i >= 1 && i <= sentences.length)
      .map((i) => sentences[i - 1])
      .join(" ")
      .trim()
    if (hasEnoughWords(text)) hits.push({ file, ...(id !== undefined ? { id } : {}), text })
  }
  return hits
}

interface PreparedHit {
  hit: SearchHit
  sentences: string[]
  numbered: string
}

const prepareHit = (hit: SearchHit): PreparedHit | null => {
  if (!hit.text) return null
  const sentences = splitSentences(hit.text)
  if (sentences.length === 0) return null
  return { hit, sentences, numbered: formatNumberedPassage(sentences) }
}

const buildBatchSchema = (labels: string[]) =>
  z.object(
    Object.fromEntries(labels.map((label) => [label, z.array(z.array(z.number().int().min(1)))]))
  )

const formatBatchPassage = (prepared: PreparedHit[], labels: string[]): string =>
  prepared.map((p, i) => `[${labels[i]}]\n${p.numbered}`).join("\n\n")

const callSemanticFilterBatch = async (
  intent: string,
  prepared: PreparedHit[]
): Promise<number[][][]> => {
  const labels = prepared.map((_, i) => toLetter(i))
  const schema = buildBatchSchema(labels)

  const blocks = await callLlm({
    endpoint: SEMANTIC_FILTER_ENDPOINT,
    messages: [
      toSystem(intent),
      toSystem(formatBatchPassage(prepared, labels)),
      toSystem(FILTER_CALL_TO_ACTION),
    ],
    responseFormat: toResponseFormat(schema),
  })

  const text = extractText(blocks)
  if (!text) return prepared.map(() => [])

  const parsed = schema.safeParse(JSON.parse(text))
  if (!parsed.success) return prepared.map(() => [])

  return labels.map((label) => parsed.data[label] ?? [])
}

const FILTER_CACHE_PREFIX = "filter"
const FILTER_CACHE_CAP = 200_000

const hitCacheKey = (intent: string, numbered: string): string => buildKey([intent, numbered])

const lookupHitCache = async (
  intent: string,
  prepared: PreparedHit[]
): Promise<(number[][] | undefined)[]> =>
  Promise.all(
    prepared.map((p) => tryGet<number[][]>(FILTER_CACHE_PREFIX, hitCacheKey(intent, p.numbered)))
  )

const cacheHitResults = async (
  intent: string,
  prepared: PreparedHit[],
  results: number[][][]
): Promise<void> => {
  await Promise.all(
    prepared.map((p, i) =>
      tryPut(FILTER_CACHE_PREFIX, hitCacheKey(intent, p.numbered), results[i], FILTER_CACHE_CAP)
    )
  )
}

const cachedCallSemanticFilterBatch = async (
  intent: string,
  prepared: PreparedHit[]
): Promise<number[][][]> => {
  const cached = await lookupHitCache(intent, prepared)

  const uncached = prepared.filter((_, i) => cached[i] === undefined)

  if (uncached.length === 0) return cached as number[][][]

  const fresh = await callSemanticFilterBatch(intent, uncached)
  await cacheHitResults(intent, uncached, fresh)

  let freshIdx = 0
  return cached.map((v) => v ?? fresh[freshIdx++])
}

const reconstructBatchHits = (prepared: PreparedHit[], results: number[][][]): SearchHit[] =>
  prepared.flatMap((p, i) => {
    const groups = results[i]
    if (!groups || groups.length === 0) return []
    return reconstructHits(p.sentences, groups, p.hit.file, p.hit.id)
  })

const filterBatch = async (hits: SearchHit[], intent: string): Promise<SearchHit[]> => {
  const prepared = hits.map(prepareHit).filter((p): p is PreparedHit => p !== null)
  if (prepared.length === 0) return hits.filter((h) => !h.text)

  try {
    const results = await cachedCallSemanticFilterBatch(intent, prepared)
    const passThrough = hits.filter((h) => !h.text)
    return [...passThrough, ...reconstructBatchHits(prepared, results)]
  } catch (e) {
    console.error("[FILTER] batch failed", e)
    return []
  }
}

export const filterAndGrow = async (
  hits: SearchHit[],
  intent: string,
  files: FileStore
): Promise<SearchHit[]> => {
  const filtered = await filterBatch(hits, intent)
  return growHits(filtered, files)
}
