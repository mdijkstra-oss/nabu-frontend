import { queryBm25, indexedLanguages, ownedHashesForFile, type Bm25Hit } from "./store"

const hashesForLanguage = (language: string, scopeFiles: string[]): Set<string> => {
  const out = new Set<string>()
  for (const file of scopeFiles)
    for (const hash of ownedHashesForFile(language, file)) out.add(hash)
  return out
}

const byScoreDesc = (a: Bm25Hit, b: Bm25Hit): number => b.score - a.score

export const searchBm25Live = (text: string, limit: number, scopeFiles?: string[]): Bm25Hit[] => {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const hits: Bm25Hit[] = []
  for (const language of indexedLanguages()) {
    const hashes = scopeFiles ? hashesForLanguage(language, scopeFiles) : undefined
    if (hashes && hashes.size === 0) continue
    hits.push(...queryBm25(language, trimmed, limit, hashes ? { hashes } : {}))
  }
  return hits.sort(byScoreDesc).slice(0, limit)
}
