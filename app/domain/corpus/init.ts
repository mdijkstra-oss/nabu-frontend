import { getFiles } from "~/lib/files/store"
import { getDatabase } from "~/domain/db/database"
import { fetchLanguageStats, filterSignificantLanguages } from "~/lib/search/resolve-semantic"
import { getCorpusDescriptions, getDescriptionsHash } from "./selectors"
import type { SemanticContext } from "~/lib/search/resolve-semantic"
import type { Database } from "~/lib/db/types"

export type SemanticContextBase = Pick<
  SemanticContext,
  "db" | "embeddingsUrl" | "descriptions" | "descriptionsHash"
>

export const setCorpusTick = (next: () => Promise<void>): void => {
  tick = next
}

export const buildSemanticContext = async (
  db: Database,
  embeddingsUrl: string
): Promise<SemanticContextBase> => {
  await ensureCorpusFresh()
  const files = getFiles()
  const descriptions = getCorpusDescriptions(files)
  const descriptionsHash = getDescriptionsHash(descriptions)
  return { db, embeddingsUrl, descriptions, descriptionsHash }
}

export const getSignificantLanguages = async (): Promise<string[]> => {
  const db = getDatabase()
  if (!db) return ["eng"]
  const rows = await fetchLanguageStats(db)
  return filterSignificantLanguages(rows)
}

let tick: (() => Promise<void>) | null = null

const ensureCorpusFresh = (): Promise<void> => (tick ? tick() : Promise.resolve())
