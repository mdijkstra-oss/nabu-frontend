import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useSyncExternalStore } from "react"
import { getFiles, subscribe } from "~/lib/files/store"
import { findSearchById } from "~/domain/data-blocks/settings/searches/selectors"
import {
  isSelectionSearch,
  parseSelectionOrder,
  selectionHits,
} from "~/domain/search/selection-search"
import { getDatabase } from "~/domain/db/database"
import { getEmbeddingsUrl } from "~/lib/embeddings/env"
import { buildSemanticContext } from "~/domain/corpus/init"
import { updateSearchCache } from "~/lib/agent/tools/search/settings"
import { resolveSemanticSql } from "~/lib/search/resolve-semantic"
import { executeResolvedSearch, mergeByScore, runVerdictTail } from "~/lib/search/pipeline"
import { SEARCH_PAGE_SIZE } from "~/lib/search/fusion"
import type { SearchEntry, SearchHit } from "~/domain/search/types"
import type { HydeQuery, KeywordsQuery } from "~/lib/search/semantic"
import { useDebugOptions } from "~/ui/components/editor/DebugOptionsContext"
import { useLiveHits } from "./useLiveHits"

export type SearchPhase = "idle" | "resolving" | "searching" | "filtering" | "done"

interface SettledState {
  results: SearchHit[]
  hydes: HydeQuery[]
  keywords: KeywordsQuery[]
  error: string | null
  searchId: string | null
  phase: SearchPhase
  hasMore: boolean
}

const EMPTY: SettledState = {
  results: [],
  hydes: [],
  keywords: [],
  error: null,
  searchId: null,
  phase: "idle",
  hasMore: false,
}

export interface SearchResults {
  search: SearchEntry | undefined
  results: SearchHit[]
  hydes: HydeQuery[]
  keywords: KeywordsQuery[]
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
  const debugOptions = useDebugOptions()
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
        results: mergeByScore(prev.results, hits),
      }))
    }

    const { rawRemaining, exhausted } = await runVerdictTail(
      state.remaining,
      state.highlight,
      getFiles(),
      SEARCH_PAGE_SIZE,
      appendHits
    )

    state.loading = false
    if (state.cancelled) return

    state.remaining = rawRemaining
    const hasMore = !exhausted
    setSettled((prev) => ({ ...prev, phase: hasMore ? "idle" : "done", hasMore }))
  }, [])

  useEffect(() => {
    if (isSelectionSearch(findSearchById(getFiles(), searchId))) return
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
        keywords: [],
        error: null,
        searchId,
        phase: "resolving",
        hasMore: false,
      })

      const ctx = await buildSemanticContext(db, getEmbeddingsUrl())
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
          keywords: [],
          error: resolved.error.message,
          searchId,
          phase: "done",
          hasMore: false,
        })
        return
      }

      if (resolved.value.type === "hybrid") {
        const hybrid = resolved.value
        setSettled((prev) => ({
          ...prev,
          hydes: hybrid.plan.hydes,
          keywords: hybrid.plan.keywords,
        }))
        updateSearchCache(freshSearch.id, hybrid.embeddings, hybrid.highlight)
      }

      setSettled((prev) => ({ ...prev, phase: "searching" }))

      const updatedSearch = findSearchById(getFiles(), searchId)
      if (!updatedSearch || cancelled) return

      const appendHits = (hits: SearchHit[]) => {
        if (cancelled) return
        setSettled((prev) => ({
          ...prev,
          results: mergeByScore(prev.results, hits),
          phase: prev.phase === "searching" ? "filtering" : prev.phase,
        }))
      }

      const result = await executeResolvedSearch(
        resolved.value,
        updatedSearch.sql,
        updatedSearch.highlight,
        ctx.db,
        getFiles(),
        SEARCH_PAGE_SIZE,
        appendHits
      )

      if (cancelled) return

      if (!result.ok) {
        setSettled({
          results: [],
          hydes: [],
          keywords: [],
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

    run().catch((e) => {
      if (cancelled) return
      const message = e instanceof Error ? e.message : String(e)
      console.error("[useSearchResults] run failed:", e)
      setSettled({
        results: [],
        hydes: [],
        keywords: [],
        error: message,
        searchId,
        phase: "done",
        hasMore: false,
      })
    })
    return () => {
      cancelled = true
      if (contRef.current) contRef.current.cancelled = true
    }
  }, [searchId, searchSql, revision, dbReady, loadMore, debugOptions])

  const isSelection = isSelectionSearch(search)
  const selectionResults = useMemo(
    () => (isSelection && search ? selectionHits(files, parseSelectionOrder(search)) : null),
    [isSelection, search, files]
  )
  const liveResults = useLiveHits(settled.results, files, !isSelection)

  return {
    search,
    results: selectionResults ?? liveResults,
    hydes: settled.hydes,
    keywords: settled.keywords,
    phase: isSelection ? "done" : settled.phase,
    error: isSelection ? null : settled.error,
    hasMore: isSelection ? false : settled.hasMore,
    loadMore,
  }
}
