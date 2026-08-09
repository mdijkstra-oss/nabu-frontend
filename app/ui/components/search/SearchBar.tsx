"use client"

import { useMemo, useState } from "react"
import type { SearchEntry } from "~/domain/search/types"
import { searchBm25Live } from "~/lib/search/bm25/live"
import { SearchBarView } from "./SearchBarView"

interface SearchBarProps {
  recentSearches: SearchEntry[]
  savedSearches: SearchEntry[]
  currentSearch?: SearchEntry
  scopeFiles: string[]
  onSelectSearch: (id: string) => void
  onToggleSave: (id: string) => void
  onPickInStack: (file: string) => void
  onPickCorpus: (file: string) => void
  onRunAi: (query: string) => void
}

const IN_STACK_LIMIT = 8
const CORPUS_LIMIT = 16

export const SearchBar = ({ scopeFiles, ...viewProps }: SearchBarProps) => {
  const [query, setQuery] = useState("")

  const q = query.trim()
  const typing = q.length > 0

  const stackHits = useMemo(
    () => (typing ? searchBm25Live(q, IN_STACK_LIMIT, scopeFiles) : []),
    [q, typing, scopeFiles]
  )
  const corpusHits = useMemo(() => {
    if (!typing) return []
    const scope = new Set(scopeFiles)
    return searchBm25Live(q, CORPUS_LIMIT).filter((h) => !scope.has(h.file))
  }, [q, typing, scopeFiles])

  return (
    <SearchBarView
      query={query}
      onQueryChange={setQuery}
      stackHits={stackHits}
      corpusHits={corpusHits}
      {...viewProps}
    />
  )
}
