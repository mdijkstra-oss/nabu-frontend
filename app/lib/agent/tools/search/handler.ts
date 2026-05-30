import type { ToolResult } from "../../types"
import { SearchArgs } from "./def"
import { registerSpecialHandler } from "../../executors/delegation"
import { getDatabase } from "~/domain/db/database"
import { getLlmHost } from "~/lib/agent/env"
import { stripPaging } from "~/lib/search/paging"
import { SEMANTIC_ABSENCE_HINT } from "~/lib/search/semantic"
import { runSearchPipeline } from "~/lib/search/pipeline"
import { saveNewSearch } from "./settings"
import { getFiles } from "~/lib/files/store"
import { getSearchEntries } from "~/domain/data-blocks/settings/searches/selectors"
import { buildSemanticContext } from "~/domain/corpus/init"
import type { SearchHit } from "~/domain/search/types"

const MAX_DISPLAY_ROWS = 50

const formatHit = (hit: SearchHit): string => {
  const prefix = hit.id ? `${hit.file} → ${hit.id}` : hit.file
  if (hit.matches && hit.matches.length > 0) return `${prefix}: ${hit.matches.join(" … ")}`
  if (hit.text) return `${prefix}: ${hit.text}`
  return prefix
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
  const suffix = capped ? `\n(capped to ${MAX_DISPLAY_ROWS} rows)` : ""
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

  const result = await runSearchPipeline(
    sql,
    parsed.data.highlight,
    {
      ...ctx,
      cachedEmbeddings: existingEntry?.embeddings,
    },
    files,
    50
  )
  if (!result.ok) return { status: "error", output: result.error.message }

  const { hits, isSemantic, embeddings } = result.value
  if (hasNoResults(hits)) return formatEmpty(sql)

  const capped = hits.length > MAX_DISPLAY_ROWS
  const display = capped ? hits.slice(0, MAX_DISPLAY_ROWS) : hits
  const id = saveNewSearch({
    ...parsed.data,
    sql,
    embeddings,
    ...(result.value.highlight && { highlight: result.value.highlight }),
  })
  return { status: "ok", output: formatOutput(id, display, capped, isSemantic) }
}

registerSpecialHandler("search", handleSearch)
