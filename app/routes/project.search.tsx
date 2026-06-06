import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useEditorSelection } from "~/ui/hooks/useEditorSelection"
import { formatSelectionSuffix } from "~/lib/text/stats"
import { AnimatePresence } from "framer-motion"
import { useParams, useNavigate } from "react-router"
import { useProject } from "./project"
import { useSearchResults } from "~/ui/hooks/useSearchResults"
import { SearchHeader } from "~/ui/components/search/SearchHeader"
import { SearchResultList } from "~/ui/components/search/SearchResultList"
import { DebugOptionsProvider } from "~/ui/components/editor/DebugOptionsContext"
import { StatusBar } from "~/ui/components/StatusBar"
import type { SearchHit } from "~/domain/search/types"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { formatDebugSql, hasSemanticTokens } from "~/lib/search/semantic"
import { formatHydeDebug } from "~/lib/search/format-hydes"
import type { SearchPhase } from "~/ui/hooks/useSearchResults"
import { buildIdentifierResolver } from "~/lib/files/selectors"
import { setPageContextOverride } from "~/lib/editor/chat-context"
import { buildSearchContextMessage } from "~/domain/search/context"

const collectUniqueFiles = (hits: SearchHit[]): string[] => [...new Set(hits.map((h) => h.file))]

const collectTagIds = (files: string[], getFileTags: (filename: string) => string[]): string[] => [
  ...new Set(files.flatMap(getFileTags)),
]

const resolveTagDefinitions = (tagIds: string[], definitions: TagDefinition[]): TagDefinition[] =>
  tagIds
    .map((id) => definitions.find((d) => d.id === id))
    .filter((t): t is TagDefinition => t !== undefined)

const toggleActive = (set: Set<string>, id: string): Set<string> => {
  const next = new Set(set)
  if (next.has(id)) {
    if (next.size <= 1) return set
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

const isUntagged = (fileTags: string[]): boolean => fileTags.length === 0

const hasAnyActiveTag = (fileTags: string[], active: Set<string>): boolean =>
  fileTags.some((t) => active.has(t))

const filterHitsByTags = (
  hits: SearchHit[],
  activeTags: Set<string>,
  getFileTags: (filename: string) => string[]
): SearchHit[] =>
  activeTags.size === 0
    ? hits
    : hits.filter((h) => {
        const tags = getFileTags(h.file)
        return isUntagged(tags) || hasAnyActiveTag(tags, activeTags)
      })

const countUniqueFiles = (hits: SearchHit[]): number => new Set(hits.map((h) => h.file)).size

const searchStatusText = (
  phase: SearchPhase,
  count: number,
  fileCount: number,
  isSemantic: boolean
): string | null => {
  if (phase === "resolving") return "Resolving search embeddings"
  if (phase === "searching") return "Pre-selecting in corpus"
  if (phase === "filtering" && count === 0) return "Narrowing down results"
  const qualifier = isSemantic ? "potential " : ""
  if (count > 0) return `Showing ${count} ${qualifier}results across ${fileCount} files`
  return null
}

export default function ProjectSearch() {
  const params = useParams<{ projectId: string; searchId: string }>()
  const navigate = useNavigate()
  const { files, dbReady, debugOptions, getFileTags, tagDefinitions, actionBar } = useProject()
  const [revision, _setRevision] = useState(0)
  const { search, results, hydes, phase, error, hasMore, loadMore } = useSearchResults(
    params.searchId ?? "",
    revision,
    dbReady,
    !!debugOptions.skipFilter,
    !!debugOptions.skipBarrenCheck
  )
  const tagOptions = useMemo(() => {
    const uniqueFiles = collectUniqueFiles(results)
    const tagIds = collectTagIds(uniqueFiles, getFileTags)
    return resolveTagDefinitions(tagIds, tagDefinitions)
  }, [results, getFileTags, tagDefinitions])

  const allTagIds = useMemo(() => new Set(tagOptions.map((t) => t.id)), [tagOptions])
  const [activeTags, setActiveTags] = useState<Set<string>>(allTagIds)

  useEffect(() => {
    setActiveTags(allTagIds)
  }, [allTagIds])

  const handleToggleTag = useCallback(
    (id: string) => setActiveTags((prev) => toggleActive(prev, id)),
    []
  )

  const filteredResults = useMemo(
    () => filterHitsByTags(results, activeTags, getFileTags),
    [results, activeTags, getFileTags]
  )

  const editorSelection = useEditorSelection()
  const fileCount = useMemo(() => countUniqueFiles(filteredResults), [filteredResults])
  const isPending = search?.sql.length === 0
  const isSemantic = search ? hasSemanticTokens(search.sql) : false
  const baseStatusText = isPending
    ? "Writing search query"
    : searchStatusText(phase, filteredResults.length, fileCount, isSemantic)
  const statusText = baseStatusText
    ? `${baseStatusText}${formatSelectionSuffix(editorSelection?.text)}`
    : null
  const isLoading =
    isPending || phase === "resolving" || phase === "searching" || phase === "filtering"
  const isDone = !isPending && phase === "done"

  const searchDataRef = useRef({ search, results, files })

  useEffect(() => {
    searchDataRef.current = { search, results, files }
  }, [search, results, files])

  useEffect(() => {
    setPageContextOverride(() => {
      const { search: s, results: r, files: f } = searchDataRef.current
      if (!s) return null
      return buildSearchContextMessage(s, r, f)
    })
    return () => setPageContextOverride(undefined)
  }, [])

  const loadMoreRef = useRef(loadMore)
  const hasMoreRef = useRef(hasMore)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    loadMoreRef.current = loadMore
    hasMoreRef.current = hasMore
  })

  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    if (!el) return

    const onScroll = () => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      const isNearBottom = remaining < el.clientHeight
      if (isNearBottom && hasMoreRef.current) loadMoreRef.current()
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    cleanupRef.current = () => el.removeEventListener("scroll", onScroll)
  }, [])

  const resolveIds = useMemo(() => buildIdentifierResolver(files), [files])

  const showDebugSql = !!debugOptions.renderAsJson

  if (!params.projectId || !params.searchId) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-subtext-color">Invalid search URL</span>
      </div>
    )
  }

  if (!search) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-subtext-color">Search not found</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-error-600">{error}</span>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col gap-2 bg-neutral-100 p-2">
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto rounded-xl border border-solid border-panel-border bg-default-background px-12 py-8"
      >
        <div className="flex w-full max-w-[1024px] flex-col items-start gap-6">
          <SearchHeader
            title={resolveIds(search.title)}
            description={resolveIds(search.description)}
            tags={tagOptions}
            activeTags={activeTags}
            onToggleTag={handleToggleTag}
          />
          {showDebugSql && (
            <div className="flex w-full flex-col gap-2">
              <pre className="w-full rounded-md bg-neutral-100 px-4 py-3 text-caption font-caption text-subtext-color whitespace-pre-wrap break-words">
                {formatDebugSql(search.sql)}
              </pre>
              {search.highlight && (
                <pre className="w-full rounded-md bg-neutral-100 px-4 py-3 text-caption font-caption text-subtext-color whitespace-pre-wrap break-words">
                  {search.highlight}
                </pre>
              )}
              {hydes.length > 0 && (
                <pre className="w-full rounded-md bg-neutral-100 px-4 py-3 text-caption font-caption text-subtext-color whitespace-pre-wrap break-words">
                  {formatHydeDebug(hydes)}
                </pre>
              )}
            </div>
          )}
          {isDone && results.length === 0 ? (
            <div className="flex w-full items-center justify-center py-16">
              <span className="text-body font-body text-subtext-color">No results found</span>
            </div>
          ) : (
            <DebugOptionsProvider value={debugOptions}>
              <SearchResultList
                hits={filteredResults}
                files={files}
                projectId={params.projectId}
                activeTags={activeTags}
                onNavigate={navigate}
              />
            </DebugOptionsProvider>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-solid border-panel-border bg-default-background">
        <StatusBar text={statusText} loading={isLoading} />
      </div>
      <AnimatePresence>{actionBar}</AnimatePresence>
    </div>
  )
}
