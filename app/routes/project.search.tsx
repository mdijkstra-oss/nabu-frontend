import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useEditorSelection } from "~/ui/hooks/useEditorSelection"
import { formatSelectionSuffix } from "~/lib/text/stats"
import { AnimatePresence } from "framer-motion"
import { useParams, useNavigate } from "react-router"
import { useProject } from "./project"
import { useSearchResults } from "~/ui/hooks/useSearchResults"
import { SearchBar } from "~/ui/components/search/SearchBar"
import { StatusCountLine } from "~/ui/components/search/StatusCountLine"
import { LayoutToggle } from "~/ui/components/search/LayoutToggle"
import { ResultRail } from "~/ui/components/search/ResultRail"
import { CardLayoutEngine, type CardLayoutHandle } from "~/ui/components/search/CardLayoutEngine"
import {
  ConnectedRunGroupCard,
  groupByRun,
  buildFileUrl,
  type SliceDebug,
} from "~/ui/components/search/cards"
import { TagBadge } from "~/ui/components/TagBadge"
import { DebugOptionsProvider } from "~/ui/components/editor/DebugOptionsContext"
import type { SearchHit } from "~/domain/search/types"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import type { LayoutMode, VisibleBand } from "~/lib/ui/card-layout"
import { formatDebugSql, hasSemanticTokens } from "~/lib/search/semantic"
import { formatHydeDebug } from "~/lib/search/format-hydes"
import type { SearchPhase } from "~/ui/hooks/useSearchResults"
import { setPageContextOverride } from "~/lib/editor/chat-context"
import { buildSearchContextMessage } from "~/domain/search/context"
import {
  getRecentSearches,
  getSavedSearches,
  getSearchEntries,
  toggleSearchSaved,
} from "~/domain/data-blocks/settings/searches/selectors"
import { updateSearchEntries } from "~/lib/agent/tools/search/settings"
import { dispatchTask } from "~/lib/agent/dispatch"
import { getFiles } from "~/lib/files/store"

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

const countUniqueFiles = (hits: SearchHit[]): number => collectUniqueFiles(hits).length

const searchStatusText = (
  phase: SearchPhase,
  count: number,
  fileCount: number,
  isSemantic: boolean
): string | null => {
  if (phase === "resolving") return "Generating samples to compare against"
  if (phase === "searching") return "Comparing samples against corpus"
  if (phase === "filtering" && count === 0) return "Narrowing down results"
  const qualifier = isSemantic ? "potential " : ""
  if (count > 0) return `Showing ${count} ${qualifier}results across ${fileCount} files`
  return null
}

export default function ProjectSearch() {
  const params = useParams<{ projectId: string; searchId: string }>()
  const navigate = useNavigate()
  const { files, dbReady, debugOptions, getFileTags, tagDefinitions, actionBar } = useProject()
  const [revision] = useState(0)
  const { search, results, hydes, keywords, phase, error, hasMore, loadMore } = useSearchResults(
    params.searchId ?? "",
    revision,
    dbReady
  )

  const [mode, setMode] = useState<LayoutMode>("flat")
  const [band, setBand] = useState<VisibleBand>({ current: 0, total: 0 })
  const engineRef = useRef<CardLayoutHandle>(null)

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
  const groups = useMemo(() => groupByRun(filteredResults), [filteredResults])
  const scopeFiles = useMemo(() => collectUniqueFiles(filteredResults), [filteredResults])

  const recentSearches = useMemo(() => getRecentSearches(files), [files])
  const savedSearches = useMemo(() => getSavedSearches(files), [files])

  const handleSelectSearch = useCallback(
    (id: string) => navigate(`/project/${params.projectId}/search/${id}`),
    [navigate, params.projectId]
  )
  const handleToggleSave = useCallback(
    (id: string) => updateSearchEntries(toggleSearchSaved(getSearchEntries(getFiles()), id)),
    []
  )
  const handlePickCorpus = useCallback(
    (file: string) => navigate(buildFileUrl(params.projectId ?? "", file)),
    [navigate, params.projectId]
  )
  const handleRunAi = useCallback(
    (query: string) =>
      dispatchTask({
        context: `The researcher wants to search the corpus for: "${query}". Use the search tool to find passages that match this intent and present the results.`,
        userMessage: `Search for: ${query}`,
      }),
    []
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

  const showDebugSql = !!debugOptions.renderAsJson

  const sliceDebug = useMemo<SliceDebug | undefined>(
    () =>
      debugOptions.showHitScore || debugOptions.renderAsJson
        ? { showRawText: !!debugOptions.renderAsJson }
        : undefined,
    [debugOptions]
  )

  if (!params.projectId) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-subtext-color">Invalid search URL</span>
      </div>
    )
  }

  if (params.searchId && !search) {
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

  const projectId = params.projectId

  return (
    <div className="flex h-full w-full flex-col bg-neutral-100 px-12 pt-6 pb-4">
      <div className="flex w-full flex-col gap-4">
        <SearchBar
          recentSearches={recentSearches}
          savedSearches={savedSearches}
          currentSearch={search}
          scopeFiles={scopeFiles}
          onSelectSearch={handleSelectSearch}
          onToggleSave={handleToggleSave}
          onPickInStack={(file) => engineRef.current?.scrollToFile(file)}
          onPickCorpus={handlePickCorpus}
          onRunAi={handleRunAi}
        />
        <div className="flex w-full items-center justify-between gap-4">
          <StatusCountLine loading={isLoading} statusText={statusText} />
          <LayoutToggle mode={mode} onChange={setMode} />
        </div>
        {tagOptions.length > 0 && !isLoading && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-body text-subtext-color">Filter by:</span>
            {tagOptions.map((tag) => {
              const active = activeTags.has(tag.id)
              return (
                <TagBadge
                  key={tag.id}
                  tag={tag}
                  active={active}
                  disabled={active && activeTags.size === 1}
                  onClick={() => handleToggleTag(tag.id)}
                />
              )
            })}
          </div>
        )}
        {showDebugSql && search && (
          <pre className="w-full rounded-md bg-default-background px-4 py-3 text-caption font-caption text-subtext-color whitespace-pre-wrap break-words">
            {formatDebugSql(search.sql)}
            {hydes.length > 0 && `\n\n${formatHydeDebug(hydes, keywords)}`}
          </pre>
        )}
      </div>

      <div className="mt-6 flex min-h-0 flex-1 gap-2">
        {!search || (isDone && groups.length === 0) ? (
          <div className="flex w-full items-center justify-center py-16">
            <span className="text-body font-body text-subtext-color">
              {search ? "No results found" : "Type what you are looking for to search the corpus."}
            </span>
          </div>
        ) : (
          <>
            <DebugOptionsProvider value={debugOptions}>
              <CardLayoutEngine
                ref={engineRef}
                groups={groups}
                mode={mode}
                keyboardNav
                onBandChange={setBand}
                onNearEnd={hasMore ? loadMore : undefined}
                className="flex-1"
                renderCard={(group) => (
                  <ConnectedRunGroupCard
                    group={group}
                    files={files}
                    projectId={projectId}
                    debug={sliceDebug}
                    onNavigate={navigate}
                  />
                )}
              />
            </DebugOptionsProvider>
            {mode === "stacked" && (
              <ResultRail
                band={band}
                onScrollTo={(i) => engineRef.current?.scrollToIndex(i)}
                onStep={(n) => engineRef.current?.scrollByCards(n)}
              />
            )}
          </>
        )}
      </div>

      <AnimatePresence>{actionBar}</AnimatePresence>
    </div>
  )
}
