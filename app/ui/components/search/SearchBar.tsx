"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  Search,
  CornerDownLeft,
  ChevronDown,
  LocateFixed,
  ArrowUpRight,
  Bookmark,
} from "lucide-react"
import type { SearchEntry } from "~/domain/search/types"
import { searchBm25Live } from "~/lib/search/bm25/live"
import type { Bm25Hit } from "~/lib/search/bm25/store"
import { toDisplayName } from "~/lib/files/filename"
import { BookmarkBtn } from "./BookmarkBtn"
import { cn } from "~/ui/utils"

const IN_STACK_LIMIT = 8
const CORPUS_LIMIT = 16
const SNIPPET_RADIUS = 60

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

const snippet = (text: string, query: string): ReactNode => {
  const lower = text.toLowerCase()
  const at = lower.indexOf(query.toLowerCase())
  if (at === -1) return text.slice(0, SNIPPET_RADIUS * 2)
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(text.length, at + query.length + SNIPPET_RADIUS)
  const head = (start > 0 ? "…" : "") + text.slice(start, at)
  const match = text.slice(at, at + query.length)
  const tail = text.slice(at + query.length, end) + (end < text.length ? "…" : "")
  return (
    <>
      {head}
      <mark className="rounded-sm bg-brand-100 px-0.5 text-inherit">{match}</mark>
      {tail}
    </>
  )
}

const DropdownHeader = ({ children }: { children: ReactNode }) => (
  <div className="px-3 pt-2 pb-1 text-caption-bold font-caption-bold tracking-wide text-neutral-400 uppercase">
    {children}
  </div>
)

const HitRow = ({
  hit,
  query,
  inStack,
  onPick,
}: {
  hit: Bm25Hit
  query: string
  inStack: boolean
  onPick: () => void
}) => (
  <button
    type="button"
    onClick={onPick}
    className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-neutral-50"
  >
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-caption font-caption font-bold text-subtext-color">
        {toDisplayName(hit.file)}
      </span>
      <span className="line-clamp-2 text-body font-body text-default-font">
        {snippet(hit.text, query)}
      </span>
    </div>
    <span className="mt-1 flex-none text-neutral-400" aria-hidden>
      {inStack ? <LocateFixed className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
    </span>
  </button>
)

const SearchRow = ({
  entry,
  onSelect,
  onToggleSave,
}: {
  entry: SearchEntry
  onSelect: () => void
  onToggleSave: () => void
}) => (
  <div
    onClick={onSelect}
    className="flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-neutral-50"
  >
    <BookmarkBtn saved={entry.saved} onToggle={onToggleSave} className="mt-0.5" />
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-body font-body text-default-font">{entry.title}</span>
      <span className="truncate text-caption font-caption text-subtext-color">
        {entry.description}
      </span>
    </div>
  </div>
)

export const SearchBar = ({
  recentSearches,
  savedSearches,
  currentSearch,
  scopeFiles,
  onSelectSearch,
  onToggleSave,
  onPickInStack,
  onPickCorpus,
  onRunAi,
}: SearchBarProps) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [showCorpus, setShowCorpus] = useState(false)

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

  const close = () => setOpen(false)
  const pickInStack = (file: string) => {
    onPickInStack(file)
    setQuery("")
    close()
  }
  const pickCorpus = (file: string) => {
    onPickCorpus(file)
    close()
  }
  const runAi = () => {
    if (!q) return
    onRunAi(q)
    setQuery("")
    close()
  }

  return (
    <div className="relative z-30 w-full">
      <div
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border border-solid bg-default-background px-4 py-3 transition-shadow",
          open ? "border-neutral-300 shadow-md" : "border-neutral-200 shadow-sm"
        )}
      >
        <Search className="h-5 w-5 flex-none text-neutral-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShowCorpus(false)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(close, 120)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close()
            if (e.key === "Enter") runAi()
          }}
          placeholder="Search documents, people, places, quotes…"
          className="min-w-0 flex-1 border-none bg-transparent text-body font-body text-default-font outline-none placeholder:text-neutral-400"
        />
        {currentSearch && !typing && (
          <span className="hidden max-w-[40%] truncate text-caption font-caption text-subtext-color sm:inline">
            {currentSearch.title}
          </span>
        )}
        {currentSearch && (
          <BookmarkBtn
            saved={currentSearch.saved}
            onToggle={() => onToggleSave(currentSearch.id)}
          />
        )}
      </div>

      {open && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute top-[calc(100%+8px)] left-0 right-0 z-40 max-h-[380px] overflow-y-auto rounded-2xl border border-solid border-neutral-200 bg-default-background p-2 shadow-xl"
        >
          {typing ? (
            <>
              <button
                type="button"
                onClick={runAi}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-neutral-50"
              >
                <Search className="h-4 w-4 flex-none text-subtext-color" />
                <div className="flex flex-1 flex-col">
                  <span className="text-body font-body text-default-font">
                    Search <span className="text-subtext-color">“{q}”</span>
                  </span>
                  <span className="text-caption font-caption text-subtext-color">
                    Match by description, not just exact words
                  </span>
                </div>
                <span className="flex flex-none items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-caption font-caption text-subtext-color">
                  <CornerDownLeft className="h-3 w-3" /> Enter
                </span>
              </button>

              <div className="my-2 h-px bg-neutral-100" />

              <DropdownHeader>In this stack</DropdownHeader>
              {stackHits.length > 0 ? (
                stackHits.map((hit) => (
                  <HitRow
                    key={hit.id}
                    hit={hit}
                    query={q}
                    inStack
                    onPick={() => pickInStack(hit.file)}
                  />
                ))
              ) : (
                <div className="px-3 py-2 text-body font-body text-subtext-color">
                  No matches in this stack.
                </div>
              )}

              {corpusHits.length > 0 &&
                (showCorpus ? (
                  <>
                    <DropdownHeader>Across the corpus</DropdownHeader>
                    {corpusHits.map((hit) => (
                      <HitRow
                        key={hit.id}
                        hit={hit}
                        query={q}
                        inStack={false}
                        onPick={() => pickCorpus(hit.file)}
                      />
                    ))}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCorpus(true)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-body font-body text-subtext-color transition-colors hover:bg-neutral-50"
                  >
                    <ChevronDown className="h-4 w-4" />
                    Show {corpusHits.length} more across the corpus
                  </button>
                ))}
            </>
          ) : (
            <>
              <DropdownHeader>Recent searches</DropdownHeader>
              {recentSearches.length > 0 ? (
                recentSearches.map((entry) => (
                  <SearchRow
                    key={entry.id}
                    entry={entry}
                    onSelect={() => {
                      onSelectSearch(entry.id)
                      close()
                    }}
                    onToggleSave={() => onToggleSave(entry.id)}
                  />
                ))
              ) : (
                <div className="px-3 py-2 text-body font-body text-subtext-color">
                  No recent searches.
                </div>
              )}

              <div className="my-2 h-px bg-neutral-100" />

              <DropdownHeader>Saved searches</DropdownHeader>
              {savedSearches.length > 0 ? (
                savedSearches.map((entry) => (
                  <SearchRow
                    key={entry.id}
                    entry={entry}
                    onSelect={() => {
                      onSelectSearch(entry.id)
                      close()
                    }}
                    onToggleSave={() => onToggleSave(entry.id)}
                  />
                ))
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 text-caption font-caption text-subtext-color">
                  <Bookmark className="h-4 w-4 text-neutral-300" />
                  Click the bookmark icon on a search to save it.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
