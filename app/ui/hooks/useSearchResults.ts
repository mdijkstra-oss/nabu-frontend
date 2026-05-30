import { useState, useEffect, useRef, useCallback } from "react"
import { useSyncExternalStore } from "react"
import { getFiles, subscribe } from "~/lib/files/store"
import { findSearchById } from "~/domain/data-blocks/settings/searches/selectors"
import { getDatabase } from "~/domain/db/database"
import { getLlmHost } from "~/lib/agent/env"
import { buildSemanticContext } from "~/domain/corpus/init"
import { updateSearchCache } from "~/lib/agent/tools/search/settings"
import { resolveSemanticSql } from "~/lib/search/resolve-semantic"
import { filterParallel, FILTER_BATCH_SIZE } from "~/lib/search/filter-hits"
import { runSearchPipeline, sortByScore, MAX_BARREN_BATCHES } from "~/lib/search/pipeline"
import type { SearchEntry, SearchHit } from "~/domain/search/types"
import type { HydeQuery } from "~/lib/search/semantic"

export type SearchPhase = "idle" | "resolving" | "searching" | "filtering" | "done"

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

interface ContinuationState {
  remaining: SearchHit[]
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

  const isStale = settled.searchId !== null && settled.searchId !== searchId
  if (isStale) setSettled(EMPTY)

  const searchSql = search?.sql ?? ""
  const contRef = useRef<ContinuationState | null>(null)

  const loadMore = useCallback(async () => {
    const state = contRef.current
    if (!state || state.loading || state.cancelled || state.remaining.length === 0) return

    state.loading = true
    setSettled((prev) => ({ ...prev, phase: "filtering" }))

    const appendHits = (hits: SearchHit[]) => {
      if (state.cancelled) return
      setSettled((prev) => ({
        ...prev,
        results: sortByScore([...prev.results, ...hits]),
      }))
    }

    const { consumed, barren } = await filterParallel(
      state.remaining,
      state.highlight,
      getFiles(),
      appendHits,
      { target: 30, maxBarren: MAX_BARREN_BATCHES }
    )

    state.loading = false
    if (state.cancelled) return

    const rawConsumed = Math.min(consumed * FILTER_BATCH_SIZE, state.remaining.length)
    state.remaining = state.remaining.slice(rawConsumed)
    const hasMore = state.remaining.length > 0 && !barren
    setSettled((prev) => ({ ...prev, phase: hasMore ? "idle" : "done", hasMore }))
  }, [])

  useEffect(() => {
    if (!searchSql || !dbReady) return

    const db = getDatabase()
    if (!db) return

    const freshSearch = findSearchById(getFiles(), searchId)
    if (!freshSearch) return

    let cancelled = false

    if (contRef.current) contRef.current.cancelled = true
    contRef.current = null

    const run = async () => {
      setSettled({
        results: [],
        hydes: [],
        error: null,
        searchId,
        phase: "resolving",
        hasMore: false,
      })

      const ctx = await buildSemanticContext(db, getLlmHost())
      if (cancelled) return

      const resolved = await resolveSemanticSql(freshSearch.sql, {
        ...ctx,
        cachedEmbeddings: freshSearch.embeddings,
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

      if (resolved.value.type === "hybrid") {
        const hybrid = resolved.value
        setSettled((prev) => ({ ...prev, hydes: hybrid.plan.hydes }))
        updateSearchCache(freshSearch.id, hybrid.embeddings, hybrid.highlight)
      }

      setSettled((prev) => ({ ...prev, phase: "searching" }))

      const updatedSearch = findSearchById(getFiles(), searchId)
      if (!updatedSearch || cancelled) return

      const appendHits = (hits: SearchHit[]) => {
        if (cancelled) return
        setSettled((prev) => ({
          ...prev,
          results: sortByScore([...prev.results, ...hits]),
        }))
      }

      const result = await runSearchPipeline(
        updatedSearch.sql,
        updatedSearch.highlight,
        {
          ...ctx,
          cachedEmbeddings: updatedSearch.embeddings,
        },
        getFiles(),
        30,
        appendHits
      )

      if (cancelled) return

      if (!result.ok) {
        setSettled({
          results: [],
          hydes: [],
          error: result.error.message,
          searchId,
          phase: "done",
          hasMore: false,
        })
        return
      }

      const { hits, rawRemaining, hydes, needsFiltering, exhausted } = result.value

      const effectiveHighlight = result.value.highlight || updatedSearch.highlight

      const hasMore = needsFiltering && !exhausted && rawRemaining.length > 0

      if (hasMore) {
        contRef.current = {
          remaining: rawRemaining,
          highlight: effectiveHighlight,
          loading: false,
          cancelled,
        }
      }

      setSettled((prev) => ({
        ...prev,
        results: needsFiltering ? prev.results : hits,
        hydes,
        phase: hasMore ? "idle" : "done",
        hasMore,
      }))
    }

    run()
    return () => {
      cancelled = true
      if (contRef.current) contRef.current.cancelled = true
    }
  }, [searchId, searchSql, revision, dbReady, loadMore])

  return {
    search,
    results: settled.results,
    hydes: settled.hydes,
    phase: settled.phase,
    error: settled.error,
    hasMore: settled.hasMore,
    loadMore,
  }
}
