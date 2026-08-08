import type { Result } from "~/lib/fp/result"
import type { SearchHit } from "~/domain/search/types"
import { ok, err } from "~/lib/fp/result"
import { getFiles } from "~/lib/files/store"
import { getDatabase } from "~/domain/db/database"
import { getEmbeddingsUrl } from "~/lib/embeddings/env"
import { buildSemanticContext } from "~/domain/corpus/init"
import { findSearchById } from "~/domain/data-blocks/settings/searches/selectors"
import { updateSearchCache } from "~/lib/agent/tools/search/settings"
import { resolveSemanticSql } from "~/lib/search/resolve-semantic"
import { executeResolvedSearch } from "~/lib/search/pipeline"

export const executeSearchById = async (
  searchId: string,
  target: number,
  onResults?: (hits: SearchHit[]) => void
): Promise<Result<SearchHit[], string>> => {
  const entry = findSearchById(getFiles(), searchId)
  if (!entry) return err(`Search not found: ${searchId}`)

  const db = getDatabase()
  if (!db) return err(`No database available to execute search: ${searchId}`)

  const ctx = await buildSemanticContext(db, getEmbeddingsUrl())

  const resolved = await resolveSemanticSql(entry.sql, {
    ...ctx,
    cachedEmbeddings: entry.embeddings,
  })
  if (!resolved.ok) return err(resolved.error.message)

  if (resolved.value.type === "hybrid") {
    updateSearchCache(searchId, resolved.value.embeddings, resolved.value.highlight)
  }

  const updatedEntry = findSearchById(getFiles(), searchId) ?? entry
  const result = await executeResolvedSearch(
    resolved.value,
    updatedEntry.sql,
    updatedEntry.highlight,
    ctx.db,
    getFiles(),
    target,
    onResults
  )
  if (!result.ok) return err(result.error.message)

  return ok(result.value.hits)
}
