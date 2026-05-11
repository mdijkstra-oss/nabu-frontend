import type { FileStore } from "~/lib/files/store"
import { debounce } from "~/lib/utils/debounce"
import { serialize } from "~/lib/utils/serialize"
import { isEmbeddableFile } from "~/lib/embeddings/filter"
import { stripAttributesBlock } from "~/lib/markdown/strip-attributes"
import { toEmbeddableText } from "~/lib/embeddings/text"
import { buildExcerpt } from "~/lib/text/excerpt"
import { shouldReclassify, contentHash } from "~/domain/data-blocks/attributes/topics/selectors"
import { executeFileAction } from "~/lib/data-blocks/file-action"
import { classifyDocument, type Classification, type ExistingClassifications } from "./classify"
import {
  collectClassifications,
  groupByCorpus,
  collectTypeCounts,
  collectSubjectCounts,
} from "./tree"
import { processDescriptionSync } from "./sync-descriptions"
import { processPool } from "~/lib/utils/pool"
import { getLlmHost } from "~/lib/agent/env"

type ToProseFn = (block: unknown) => string | null

const CORPUS_SYNC_DEBOUNCE = 30_000

const TOKENS_PER_SECTION = 250

interface CorpusSyncDeps {
  getFiles: () => FileStore
  getFile: (f: string) => string | undefined
  subscribe: (listener: () => void) => () => void
  toProseFns: Record<string, ToProseFn>
  getSignificantLanguages: () => Promise<string[]>
  onProgress?: (processed: number, total: number) => void
}

interface CorpusSyncHandle {
  ready: Promise<void>
  tick: () => Promise<void>
}

const findChangedFiles = (prev: FileStore, curr: FileStore): string[] => {
  const changed: string[] = []
  for (const key of Object.keys(curr)) {
    if (!isEmbeddableFile(key)) continue
    if (prev[key] !== curr[key]) changed.push(key)
  }
  return changed
}

const toExcerpt = (raw: string, toProseFns: Record<string, ToProseFn>): string => {
  const stripped = stripAttributesBlock(raw)
  const prose = toEmbeddableText(stripped, toProseFns)
  return buildExcerpt(prose, TOKENS_PER_SECTION)
}

const writeClassificationToAttributes = (
  content: string,
  classification: Classification,
  filename: string
): void => {
  executeFileAction({
    patches: [
      {
        path: filename,
        language: "json-attributes",
        ops: [
          { op: "add", path: "/type", value: classification.type },
          { op: "add", path: "/subject", value: classification.subject },
          { op: "add", path: "/hash", value: contentHash(content) },
        ],
      },
    ],
  })
}

const collectExisting = (files: FileStore): ExistingClassifications => ({
  types: [...collectTypeCounts(files).keys()],
  subjects: [...collectSubjectCounts(files).keys()],
})

interface FileToClassify {
  filename: string
  content: string
}

const classifyFile =
  (existing: ExistingClassifications, deps: CorpusSyncDeps) =>
  async (item: FileToClassify): Promise<Classification[]> => {
    const excerpt = toExcerpt(item.content, deps.toProseFns)
    if (excerpt.length === 0) return []

    const classification = await classifyDocument(excerpt, existing)
    if (!classification) {
      console.warn(`[classify] no classification for ${item.filename}`)
      return []
    }

    writeClassificationToAttributes(item.content, classification, item.filename)
    console.debug(
      `[classify] ${item.filename} → ${classification.type} / ${classification.subject}`
    )
    return [classification]
  }

const toFilesToClassify = (files: FileStore, changedFiles: string[]): FileToClassify[] =>
  changedFiles
    .filter((f) => shouldReclassify(files[f]))
    .map((filename) => ({ filename, content: files[filename] }))
    .filter((item) => item.content !== undefined)

const processTopics = async (changedFiles: string[], deps: CorpusSyncDeps): Promise<boolean> => {
  const files = deps.getFiles()
  const items = toFilesToClassify(files, changedFiles)

  if (items.length === 0) return false

  const existing = collectExisting(files)
  deps.onProgress?.(0, items.length)

  await processPool(items, classifyFile(existing, deps), () => undefined, {
    concurrency: 1,
    onItemComplete: (completed, total) => deps.onProgress?.(completed, total),
  })

  return true
}

const formatClassificationLog = (files: FileStore): string | null => {
  const classifications = collectClassifications(files)
  if (classifications.length === 0) return null
  const groups = groupByCorpus(classifications)
  const formatGroup = ({ key, count }: { key: string; count: number }): string =>
    `[classify] ${key} (${count})`
  return [
    `[classify] ${classifications.length} files classified`,
    `[classify] ${"─".repeat(35)}`,
    ...groups.map(formatGroup),
  ].join("\n")
}

export const startCorpusSync = (deps: CorpusSyncDeps): CorpusSyncHandle => {
  let previousFiles: FileStore = {}

  const doSync = async (): Promise<void> => {
    try {
      const currentFiles = deps.getFiles()
      const changed = findChangedFiles(previousFiles, currentFiles)
      previousFiles = currentFiles

      if (changed.length === 0) return

      const topicsChanged = await processTopics(changed, deps)

      if (topicsChanged) {
        const log = formatClassificationLog(deps.getFiles())
        if (log) console.debug(log)
      }

      const significantLanguages = await deps.getSignificantLanguages()
      await processDescriptionSync(deps.getFiles, significantLanguages, getLlmHost())
    } catch (e) {
      console.error("[corpus-sync] error:", e)
    }
  }

  const tick = serialize(doSync)

  const ready = tick()

  const debouncedTick = debounce(tick, CORPUS_SYNC_DEBOUNCE)
  deps.subscribe(debouncedTick)

  return { ready, tick }
}
