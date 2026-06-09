import type { Result } from "~/lib/fp/result"
import type { SearchHit, EmbeddingsCache } from "~/domain/search/types"
import type { HydeQuery, HybridSearchPlan } from "./semantic"
import type { ResolvedQuery } from "./resolve-semantic"
import type { Database } from "~/lib/db/types"
import type { FileStore } from "~/lib/files/store"
import { ok, err } from "~/lib/fp/result"
import { executeSearch, executeHybridLocal } from "./execute"
import { sanitizeSemanticError } from "./semantic"

export interface ProbeResult {
  rawHits: SearchHit[]
  hydes: HydeQuery[]
  isSemantic: boolean
  embeddings?: EmbeddingsCache
  highlight?: string
}

export interface ProbeError {
  message: string
}

const probePlain = async (sql: string, db: Database): Promise<Result<ProbeResult, ProbeError>> => {
  const result = await executeSearch(db, sql)
  if (!result.ok) return err({ message: sanitizeSemanticError(result.error.message) })
  return ok({ rawHits: result.value, hydes: [], isSemantic: false })
}

const probeHybrid = async (
  plan: HybridSearchPlan,
  embeddings: EmbeddingsCache,
  highlight: string | undefined,
  db: Database,
  files: FileStore
): Promise<Result<ProbeResult, ProbeError>> => {
  if (plan.hydes.length === 0)
    return err({ message: "Embedding resolution produced no search vectors" })

  const result = await executeHybridLocal(db, plan, files)
  if (!result.ok) return err({ message: sanitizeSemanticError(result.error.message) })
  return ok({ rawHits: result.value, hydes: plan.hydes, isSemantic: true, embeddings, highlight })
}

export const probe = (
  resolved: ResolvedQuery,
  db: Database,
  files: FileStore
): Promise<Result<ProbeResult, ProbeError>> =>
  resolved.type === "plain"
    ? probePlain(resolved.sql, db)
    : probeHybrid(resolved.plan, resolved.embeddings, resolved.highlight, db, files)
