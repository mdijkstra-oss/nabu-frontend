import type { FileStore } from "~/lib/files/store"
import { isEmbeddableFile } from "~/lib/embeddings/filter"
import { companionFilename, parseCompanionEntries } from "~/lib/embeddings/companion"
import {
  getDocumentType,
  getDocumentSubject,
} from "~/domain/data-blocks/attributes/topics/selectors"
import { getFileRaw, updateFileRaw } from "~/lib/files/store"
import { getSettings } from "~/domain/data-blocks/settings/selectors"
import { replaceSingletonBlock } from "~/lib/data-blocks/parse"
import { finalizeContent } from "~/lib/patch/apply"
import { SETTINGS_FILE } from "~/lib/files/filename"
import { toCorpusKey, type CorpusDescription } from "~/domain/corpus/types"
import { processPool } from "~/lib/utils/pool"
import {
  selectSignificantCorpora,
  collectTypeCounts,
  collectSubjectCounts,
  filterExcludedLabels,
  type CorpusCount,
} from "./tree"
import { groupNearbyLabels, buildRemaps, type LabelRemaps } from "./cluster"
import { sampleChunks } from "./sample"
import { describeGroup } from "./describe"

export const DEFAULT_CLUSTER_THRESHOLD = 0.7

const SAMPLE_COUNT = 20
const DEFAULT_LANGUAGE = "eng"

interface CorpusLanguagePair {
  corpus: string
  language: string
}

const collectCorpusLanguagePairs = (
  files: FileStore,
  remaps: LabelRemaps
): CorpusLanguagePair[] => {
  const pairSet = new Map<string, CorpusLanguagePair>()

  for (const [filename, content] of Object.entries(files)) {
    if (!isEmbeddableFile(filename)) continue
    const type = getDocumentType(content)
    const subject = getDocumentSubject(content)
    if (!type || !subject) continue

    const mappedType = remaps.types.get(type) ?? type
    const mappedSubject = remaps.subjects.get(subject) ?? subject
    const corpus = toCorpusKey(mappedType, mappedSubject)
    const companion = companionFilename(filename)
    const companionRaw = files[companion]

    if (!companionRaw) {
      const key = `${corpus}|${DEFAULT_LANGUAGE}`
      if (!pairSet.has(key)) pairSet.set(key, { corpus, language: DEFAULT_LANGUAGE })
      continue
    }

    const entries = parseCompanionEntries(companionRaw)
    const languages = new Set(entries.map((e) => e.language ?? DEFAULT_LANGUAGE))
    if (languages.size === 0) languages.add(DEFAULT_LANGUAGE)

    for (const language of languages) {
      const key = `${corpus}|${language}`
      if (!pairSet.has(key)) pairSet.set(key, { corpus, language })
    }
  }

  return [...pairSet.values()]
}

const countCorpusFiles = (files: FileStore, remaps: LabelRemaps): CorpusCount[] => {
  const counts = new Map<string, number>()
  for (const [filename, content] of Object.entries(files)) {
    if (!isEmbeddableFile(filename)) continue
    const type = getDocumentType(content)
    const subject = getDocumentSubject(content)
    if (!type || !subject) continue
    const mappedType = remaps.types.get(type) ?? type
    const mappedSubject = remaps.subjects.get(subject) ?? subject
    const corpus = toCorpusKey(mappedType, mappedSubject)
    counts.set(corpus, (counts.get(corpus) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([corpus, count]) => ({ corpus, count }))
    .sort((a, b) => b.count - a.count)
}

const filterBySignificantCorpora = (
  pairs: CorpusLanguagePair[],
  significant: Set<string>
): CorpusLanguagePair[] => pairs.filter((p) => significant.has(p.corpus))

const filterByLanguages = (
  pairs: CorpusLanguagePair[],
  languages: string[]
): CorpusLanguagePair[] => {
  const langSet = new Set(languages)
  return pairs.filter((p) => langSet.has(p.language))
}

const descriptionKey = (d: CorpusDescription): string => `${d.corpus}|${d.language}`

const findMissingPairs = (
  pairs: CorpusLanguagePair[],
  existing: CorpusDescription[]
): CorpusLanguagePair[] => {
  const existingKeys = new Set(existing.map(descriptionKey))
  return pairs.filter((p) => !existingKeys.has(`${p.corpus}|${p.language}`))
}

const removeStale = (
  existing: CorpusDescription[],
  activePairs: CorpusLanguagePair[]
): CorpusDescription[] => {
  const activeKeys = new Set(activePairs.map((p) => `${p.corpus}|${p.language}`))
  return existing.filter((d) => activeKeys.has(descriptionKey(d)))
}

const writeDescriptions = (descriptions: CorpusDescription[]): void => {
  const raw = getFileRaw(SETTINGS_FILE) ?? ""
  const current = getSettings(raw) ?? {}
  const updated = { ...current, corpusDescriptions: descriptions }
  const newRaw = replaceSingletonBlock(raw, "json-settings", JSON.stringify(updated, null, 2))
  const result = finalizeContent(SETTINGS_FILE, newRaw, { original: raw })
  if (result.status === "error") {
    console.error("[corpus-describe] failed to write descriptions:", result.error)
    return
  }
  updateFileRaw(result.path, result.content)
}

const clusterAxes = async (
  files: FileStore,
  baseUrl: string,
  threshold: number
): Promise<LabelRemaps> => {
  const typeCounts = collectTypeCounts(files)
  const subjectCounts = collectSubjectCounts(files)
  const types = filterExcludedLabels([...typeCounts.keys()])
  const subjects = filterExcludedLabels([...subjectCounts.keys()])

  const [typeClusters, subjectClusters] = await Promise.all([
    groupNearbyLabels(types, baseUrl, threshold, typeCounts),
    groupNearbyLabels(subjects, baseUrl, threshold, subjectCounts),
  ])

  console.debug(
    `[corpus-cluster] types: ${types.length} → ${typeClusters.length} clusters, ` +
      `subjects: ${subjects.length} → ${subjectClusters.length} clusters`
  )

  return buildRemaps(typeClusters, subjectClusters)
}

export const processDescriptionSync = async (
  getFiles: () => FileStore,
  significantLanguages: string[],
  baseUrl: string,
  threshold = DEFAULT_CLUSTER_THRESHOLD
): Promise<void> => {
  const files = getFiles()

  const remaps = await clusterAxes(files, baseUrl, threshold)
  const corpusCounts = countCorpusFiles(files, remaps)
  const significant = new Set(selectSignificantCorpora(corpusCounts))
  const allPairs = collectCorpusLanguagePairs(files, remaps)
  const significantPairs = filterBySignificantCorpora(allPairs, significant)
  const pairs = filterByLanguages(significantPairs, significantLanguages)

  const raw = getFileRaw(SETTINGS_FILE)
  const settings = getSettings(raw)
  const existing = settings?.corpusDescriptions ?? []

  const cleaned = removeStale(existing, pairs)
  const missing = findMissingPairs(pairs, cleaned)

  const removed = existing.length - cleaned.length
  if (removed > 0) console.debug(`[corpus-describe] removing ${removed} stale descriptions`)

  if (missing.length === 0 && removed === 0) return

  const descriptions = [...cleaned]

  await processPool(
    missing,
    async ({ corpus, language }) => {
      const samples = sampleChunks(getFiles(), corpus, language, SAMPLE_COUNT, remaps)
      if (samples.length === 0) return []
      const description = await describeGroup(samples, language, corpus)
      return [description]
    },
    (results: CorpusDescription[]) => {
      descriptions.push(...results)
    },
    { warmup: 1 }
  )

  writeDescriptions(descriptions)
  console.debug(`[corpus-describe] ${descriptions.length} descriptions (${missing.length} new)`)
}
