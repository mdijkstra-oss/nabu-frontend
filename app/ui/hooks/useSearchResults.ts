import { useState, useEffect, useRef, useCallback } from "react"
import { useSyncExternalStore } from "react"
import { getFiles, subscribe } from "~/lib/files/store"
import { findSearchById } from "~/domain/data-blocks/settings/searches/selectors"
import { getDatabase } from "~/domain/db/database"
import { executeSearch, executeHybridLocal } from "~/lib/search/execute"
import { resolveSemanticSql } from "~/lib/search/resolve-semantic"
import { sanitizeSemanticError, sqlQueriesFilesTable } from "~/lib/search/semantic"
import { filterParallel, FILTER_BATCH_SIZE } from "~/lib/search/filter-hits"
import { growHits } from "~/lib/search/slices"
import { getLlmHost } from "~/lib/agent/env"
import { buildSemanticContext } from "~/domain/corpus/init"
import { updateSearchHydes } from "~/lib/agent/tools/search/settings"
import type { SearchEntry, SearchHit } from "~/domain/search/types"
import type { HydeQuery } from "~/lib/search/semantic"

export type SearchPhase = "idle" | "searching" | "filtering" | "done"

interface SettledState {
  results: SearchHit[]
  hydes: HydeQuery[]
  error: string | null
  searchId: string | null
  phase: SearchPhase
  hasMore: boolean
}

const EMPTY: SettledState = {
  results: [],
  hydes: [],
  error: null,
  searchId: null,
  phase: "idle",
  hasMore: false,
}

export interface SearchResults {
  search: SearchEntry | undefined
  results: SearchHit[]
  hydes: HydeQuery[]
  phase: SearchPhase
  error: string | null
  hasMore: boolean
  loadMore: () => void
}

const sortByScore = (hits: SearchHit[]): SearchHit[] =>
  [...hits].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

interface FilterState {
  rawHits: SearchHit[]
  cursor: number
  highlight: string
  loading: boolean
  cancelled: boolean
}

export const useSearchResults = (
  searchId: string,
  revision = 0,
  dbReady = false
): SearchResults => {
  const files = useSyncExternalStore(subscribe, getFiles)
  const search = findSearchById(files, searchId)
  const [settled, setSettled] = useState<SettledState>(EMPTY)
  const filterRef = useRef<FilterState | null>(null)

  const filterNextChunk = useCallback(async () => {
    const state = filterRef.current
    if (!state || state.loading || state.cancelled || state.cursor >= state.rawHits.length) return

    state.loading = true
    setSettled((prev) => ({ ...prev, phase: "filtering" }))

    const remaining = state.rawHits.slice(state.cursor)
    const appendHits = (hits: SearchHit[]) => {
      if (state.cancelled) return
      setSettled((prev) => ({
        ...prev,
        results: sortByScore([...prev.results, ...hits]),
      }))
    }

    const { consumed } = await filterParallel(
      remaining,
      state.highlight,
      getFiles(),
      appendHits,
      FILTER_BATCH_SIZE
    )

    state.cursor += Math.min(consumed * FILTER_BATCH_SIZE, remaining.length)
    state.loading = false

    if (state.cancelled) return

    const hasMore = state.cursor < state.rawHits.length
    setSettled((prev) => ({ ...prev, phase: hasMore ? "idle" : "done", hasMore }))
  }, [])

  useEffect(() => {
    if (!search || !dbReady) return

    const db = getDatabase()
    if (!db) return

    let cancelled = false

    if (filterRef.current) filterRef.current.cancelled = true
    filterRef.current = null

    const run = async () => {
      setSettled({
        results: [],
        hydes: [],
        error: null,
        searchId,
        phase: "searching",
        hasMore: false,
      })

      const ctx = await buildSemanticContext(db, getLlmHost())
      const resolved = await resolveSemanticSql(search.sql, {
        ...ctx,
        cachedHydes: search.hydes,
        cachedDescriptionsHash: search.descriptionsHash,
      })
      if (cancelled) return
      if (!resolved.ok) {
        setSettled({
          results: [],
          hydes: [],
          error: resolved.error.message,
          searchId,
          phase: "done",
          hasMore: false,
        })
        return
      }

      const hydes = resolved.value.type === "hybrid" ? resolved.value.plan.hydes : []

      if (resolved.value.type === "hybrid") {
        updateSearchHydes(search.id, resolved.value.hydesCache, resolved.value.descriptionsHash)
      }

      const rawHits =
        resolved.value.type === "plain"
          ? await executeSearch(db, resolved.value.sql)
          : await executeHybridLocal(db, resolved.value.plan)

      if (cancelled) return
      if (!rawHits.ok) {
        setSettled({
          results: [],
          hydes,
          error: sanitizeSemanticError(rawHits.error.message),
          searchId,
          phase: "done",
          hasMore: false,
        })
        return
      }

      console.log("[SEARCH] raw hits before filtering:", rawHits.value.slice(0, 5))

      setSettled((prev) => ({ ...prev, hydes }))

      if (rawHits.value.length === 0) {
        setSettled((prev) => ({ ...prev, hydes, phase: "done", hasMore: false }))
        return
      }

      const needsFiltering = sqlQueriesFilesTable(search.sql)

      if (!needsFiltering) {
        const grown = growHits(rawHits.value, getFiles())
        if (cancelled) return
        setSettled((prev) => ({ ...prev, results: grown, phase: "done", hasMore: false }))
        return
      }

      filterRef.current = {
        rawHits: rawHits.value,
        cursor: 0,
        highlight: search.highlight,
        loading: false,
        cancelled,
      }

      filterNextChunk()
    }

    run()
    return () => {
      cancelled = true
      if (filterRef.current) filterRef.current.cancelled = true
    }
  }, [search, searchId, revision, dbReady, filterNextChunk])

  return {
    search,
    results: settled.results,
    hydes: settled.hydes,
    phase: settled.phase,
    error: settled.error,
    hasMore: settled.hasMore,
    loadMore: filterNextChunk,
  }
}
