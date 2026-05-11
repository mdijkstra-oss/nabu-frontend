import { getFiles, getFileRaw } from "~/lib/files/store"
import { subscribeContentChanges } from "~/lib/files/subscribe-content"
import { toProseFns } from "~/domain/data-blocks/prose-registry"
import { getDatabase } from "~/domain/db/database"
import { startCorpusSync } from "~/lib/corpus/sync-topics"
import { fetchLanguageStats, filterSignificantLanguages } from "~/lib/search/resolve-semantic"
import { getCorpusDescriptions, getDescriptionsHash } from "./selectors"
import type { SemanticContext } from "~/lib/search/resolve-semantic"
import type { Database } from "~/lib/db/types"

export type SemanticContextBase = Pick<
  SemanticContext,
  "db" | "baseUrl" | "descriptions" | "descriptionsHash"
>

type OnSyncProgress = (processed: number, total: number) => void

let tick: (() => Promise<void>) | null = null

const ensureCorpusFresh = (): Promise<void> => (tick ? tick() : Promise.resolve())

export const buildSemanticContext = async (
  db: Database,
  baseUrl: string
): Promise<SemanticContextBase> => {
  await ensureCorpusFresh()
  const files = getFiles()
  const descriptions = getCorpusDescriptions(files)
  const descriptionsHash = getDescriptionsHash(descriptions)
  return { db, baseUrl, descriptions, descriptionsHash }
}

const getSignificantLanguages = async (): Promise<string[]> => {
  const db = getDatabase()
  if (!db) return ["eng"]
  const rows = await fetchLanguageStats(db)
  return filterSignificantLanguages(rows)
}

export const startTopicAssignment = async (onProgress?: OnSyncProgress): Promise<void> => {
  const handle = startCorpusSync({
    getFiles,
    getFile: (f) => {
      const raw = getFileRaw(f)
      return raw || undefined
    },
    subscribe: subscribeContentChanges,
    toProseFns,
    getSignificantLanguages,
    onProgress,
  })

  tick = handle.tick

  await handle.ready
}
