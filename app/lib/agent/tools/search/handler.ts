import type { ToolResult } from "../../types"
import { SearchArgs } from "./def"
import { registerSpecialHandler } from "../../executors/delegation"
import { getDatabase } from "~/domain/db/database"
import { getLlmHost } from "~/lib/agent/env"
import { executeSearch, executeHybridLocal } from "~/lib/search/execute"
import { resolveSemanticSql } from "~/lib/search/resolve-semantic"
import { sanitizeSemanticError, SEMANTIC_ABSENCE_HINT } from "~/lib/search/semantic"
import { stripPaging } from "~/lib/search/paging"
import { saveNewSearch } from "./settings"
import { getFiles } from "~/lib/files/store"
import { getSearchEntries } from "~/domain/data-blocks/settings/searches/selectors"
import { buildSemanticContext } from "~/domain/corpus/init"
import type { SearchHit } from "~/domain/search/types"

const MAX_SEARCH_ROWS = 50

const formatHit = (hit: SearchHit): string => {
  if (hit.id && hit.text) return `${hit.file} → ${hit.id}: ${hit.text}`
  if (hit.id) return `${hit.file} → ${hit.id}`
  if (hit.text) return `${hit.file}: ${hit.text}`
  return hit.file
}

const hasNoResults = (hits: SearchHit[]): boolean => hits.length === 0

const formatEmpty = (sql: string): ToolResult<unknown> => ({
  status: "error",
  output: `0 results returned for query: ${sql}`,
})

const formatOutput = (
  id: string,
  hits: SearchHit[],
  capped: boolean,
  isSemantic: boolean
): string => {
  const lines = hits.map(formatHit).join("\n")
  const suffix = capped ? `\n(capped to ${MAX_SEARCH_ROWS} rows)` : ""
  const link = `file://${id}`
  const linkHint = `\nIf these results answer the user's request, cite ${link} in your reply so they can open the full result page and browse every hit.`
  const semanticHint = isSemantic ? SEMANTIC_ABSENCE_HINT : ""
  return `${link}\nresult samples:\n${lines}${suffix}${linkHint}${semanticHint}`
}

const handleSearch = async (call: { args: unknown }): Promise<ToolResult<unknown>> => {
  const parsed = SearchArgs.safeParse(call.args)
  if (!parsed.success) return { status: "error", output: `Invalid args: ${parsed.error.message}` }

  const db = getDatabase()
  if (!db) return { status: "error", output: "Database not ready. Try again shortly." }

  const ctx = await buildSemanticContext(db, getLlmHost())
  const sql = stripPaging(parsed.data.sql)

  const files = getFiles()
  const existingEntry = getSearchEntries(files).find((e) => e.sql === sql)

  const resolved = await resolveSemanticSql(sql, {
    ...ctx,
    cachedHydes: existingEntry?.hydes,
    cachedDescriptionsHash: existingEntry?.descriptionsHash,
  })
  if (!resolved.ok) return { status: "error", output: resolved.error.message }

  const isSemantic = resolved.value.type === "hybrid"
  const hydes = resolved.value.type === "hybrid" ? resolved.value.hydesCache : undefined
  const entryDescriptionsHash =
    resolved.value.type === "hybrid" ? resolved.value.descriptionsHash : undefined

  const rawHits =
    resolved.value.type === "hybrid"
      ? await executeHybridLocal(db, resolved.value.plan)
      : await executeSearch(db, resolved.value.sql)

  if (!rawHits.ok) return { status: "error", output: sanitizeSemanticError(rawHits.error.message) }

  const capped = rawHits.value.length > MAX_SEARCH_ROWS
  const hits = capped ? rawHits.value.slice(0, MAX_SEARCH_ROWS) : rawHits.value
  if (hasNoResults(hits)) return formatEmpty(sql)

  const id = saveNewSearch({ ...parsed.data, sql, hydes, descriptionsHash: entryDescriptionsHash })
  return { status: "ok", output: formatOutput(id, hits, capped, isSemantic) }
}

registerSpecialHandler("search", handleSearch)
