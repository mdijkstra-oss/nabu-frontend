import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { Outlet, useNavigate, useParams, useOutletContext } from "react-router"
// NEVER use Sparkles icon
import { Eraser, FileText, Pencil } from "lucide-react"
import { DefaultPageLayout, type ActiveNav } from "~/ui/layouts/DefaultPageLayout"
import { useFiles } from "~/ui/hooks/useFiles"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { useFileImport } from "~/ui/hooks/useFileImport"
import {
  DocumentsSidebar,
  type DocSortMode,
} from "~/ui/components/sidebar/documents/DocumentsSidebar"
import { CodesSidebar } from "~/ui/components/sidebar/codes/CodesSidebar"
import type { Code } from "~/ui/components/sidebar/codes/types"
import { ExhibitsSidebar } from "~/ui/components/sidebar/exhibits/ExhibitsSidebar"
import { SearchSidebar } from "~/ui/components/sidebar/search/SearchSidebar"
import {
  getSearchEntries,
  getRecentSearches,
  getSavedSearches,
  toggleSearchSaved,
  removeSearch,
} from "~/domain/data-blocks/settings/searches/selectors"
import { updateSearchEntries, saveNewSearch } from "~/lib/agent/tools/search/settings"
import { NabuProvider } from "~/ui/components/nabu/context"
import { NabuChatSidebar } from "~/ui/components/nabu/NabuChatSidebar"
import { DebugMenuButton } from "~/ui/components/debug/DebugMenuButton"
import { DebugStreamPanel } from "~/ui/components/debug/DebugStreamPanel"
import { FileDropOverlay } from "~/ui/components/import/FileDropOverlay"
import { useNotifications } from "~/ui/hooks/useNotifications"
import { DEFAULT_DEBUG_OPTIONS, type DebugOptions } from "~/ui/components/editor/debug-config"
import { setCacheSkipped } from "~/lib/utils/storage-cache"

import { createWebSocket } from "~/lib/server/sync/websocket"
import { applyCommand } from "~/lib/server/sync/apply"
import type { Command } from "~/lib/server/sync/types"
import {
  setProjectId,
  setPersistEnabled,
  setPendingRefsSuppressed,
  resolvePendingRefsInBulk,
  waitForRequiredFiles,
} from "~/lib/files/store"
import {
  startDatabase,
  waitForDatabase,
  syncOnce,
  startBackgroundSync,
  type OnDbSyncProgress,
} from "~/domain/db/database"
import { startEmbeddings } from "~/domain/embeddings/init"
import { startTopicAssignment } from "~/domain/corpus/init"
import { WelcomeBackLoading } from "~/ui/components/WelcomeBackLoading"
import {
  getAnnotationCount,
  getAnnotationCountsByCode,
  getAnnotationGlobalCountsByCode,
  getReviewStatsByCode,
  getStoredAnnotations,
} from "~/domain/data-blocks/attributes/annotations/selectors"
import { findDocumentForCallout } from "~/domain/data-blocks/callout/selectors"
import { toDisplayName, isHiddenFile } from "~/lib/files/filename"
import { HIDDEN_TAG_ID, HIDDEN_TAG } from "~/domain/data-blocks/settings/tags/hidden"
import { buildIdentifierResolver } from "~/lib/files/selectors"
import { findSearchById } from "~/domain/data-blocks/settings/searches/selectors"
import type { SearchEntry } from "~/domain/search/types"
import { buildFlaggedSearch, buildCandidateSearch } from "~/domain/search/queries"
import { collectExhibits } from "~/domain/exhibits/selectors"
import type { ExhibitItem } from "~/domain/exhibits/types"
import { formatShortDate } from "~/lib/format/date"
import { getSettings, setSetting } from "~/lib/storage"
import { dispatchTask } from "~/lib/agent/dispatch"
import {
  buildRefineTask,
  codeWithFiles,
  codeWithSearch,
  codeWithSelection,
  codeWithSearchSelection,
} from "~/domain/actions/coding/actions"
import { resolveCodingFiles } from "~/domain/actions/coding/selectors"
import { useEditorSelection } from "~/ui/hooks/useEditorSelection"
import { resolveEditorSelection, resolveSearchSelections } from "~/lib/editor/selection-context"
import { clearCodingsPatches } from "~/domain/actions/clear-codings/apply"
import { executeUxAction } from "~/lib/data-blocks/file-action"
import { countAnnotationsInRange, buildClearSelectionOps } from "~/lib/editor/annotations/merge"
import { getLoading, subscribeLoading } from "~/lib/agent/client/store"
import { ActionBar, type ActionBarAction } from "~/ui/components/FloatingActionBar"
import { getSelectedCodes } from "~/domain/data-blocks/ux/selectors"
import { writeSelectedCodes } from "~/domain/actions/select-codes/apply"
import { getAllCodes, findCodeById } from "~/domain/data-blocks/callout/codes/selectors"

export type { DebugOptions } from "~/ui/components/editor/debug-config"

interface SidebarDocument {
  id: string
  title: string
  date: string
  editedAt: string
  tags: string[]
  annotationCount: number
}

const tagsWithHidden = (tags: string[], filename: string): string[] =>
  isHiddenFile(filename) ? [...tags, HIDDEN_TAG_ID] : tags

const formatEditedAt = (date: string | undefined): string => (date ? formatShortDate(date) : "")

const filesToSidebarDocuments = (
  files: Record<string, string>,
  getFileTags: (filename: string) => string[],
  getFileDateFn: (filename: string) => string | undefined,
  debugMode: boolean
): SidebarDocument[] =>
  Object.keys(files)
    .filter((filename) => debugMode || !isHiddenFile(filename))
    .map((filename) => {
      const rawDate = getFileDateFn(filename) ?? ""
      return {
        id: filename,
        title: toDisplayName(filename),
        date: rawDate,
        editedAt: formatEditedAt(rawDate || undefined),
        tags: tagsWithHidden(getFileTags(filename), filename),
        annotationCount: getAnnotationCount(files[filename] ?? ""),
      }
    })

const DEBUG_STORAGE_KEY = "nabu-debug-options"

const requestCompaction = (): void => {
  if (typeof window === "undefined") return
  try {
    const stored = localStorage.getItem(DEBUG_STORAGE_KEY)
    const options = stored ? JSON.parse(stored) : {}
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify({ ...options, forceCompaction: true }))
  } catch (_) {
    void _
  }
}

const loadDebugOptions = (): DebugOptions => {
  if (typeof window === "undefined") return DEFAULT_DEBUG_OPTIONS
  try {
    const stored = localStorage.getItem(DEBUG_STORAGE_KEY)
    return stored ? { ...DEFAULT_DEBUG_OPTIONS, ...JSON.parse(stored) } : DEFAULT_DEBUG_OPTIONS
  } catch {
    return DEFAULT_DEBUG_OPTIONS
  }
}

const saveDebugOptions = (options: DebugOptions): void => {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(options))
  } catch (_) {
    void _
  }
}

const resolveSearchEntry = (
  entry: SearchEntry,
  resolve: (text: string) => string
): SearchEntry => ({
  ...entry,
  title: resolve(entry.title),
  description: resolve(entry.description),
})

const resolveSearchEntries = (
  entries: SearchEntry[],
  resolve: (text: string) => string
): SearchEntry[] => entries.map((e) => resolveSearchEntry(e, resolve))

const isSyncMetaCommand = (command: Command): command is Command & { fileCount: number } =>
  command.action === "SyncMeta" && typeof command.fileCount === "number"

const isFileReceivedCommand = (command: Command): boolean =>
  command.action === "CreateFile" || command.action === "WriteFile"

const FILE_WEIGHT = 35
const DB_WEIGHT = 40
const EMBEDDING_WEIGHT = 10
const TOPIC_WEIGHT = 15

const computeFileProgress = (loaded: number, total: number): number => {
  if (loaded === 0) return 0
  if (total === 0) return Math.min(FILE_WEIGHT - 5, loaded * 2)
  return Math.round((loaded / total) * FILE_WEIGHT)
}

const computeWeightedProgress = (processed: number, total: number, weight: number): number =>
  total === 0 ? 0 : Math.round((processed / total) * weight)

export interface ProjectContextValue {
  files: Record<string, string>
  currentFile: string | null
  dbReady: boolean
  debugOptions: DebugOptions
  toggleDebugOption: (key: string) => void
  requestCompaction: () => void
  getFileTags: (filename: string) => string[]
  getFileDate: (filename: string) => string | undefined
  getFileAnnotations: (
    filename: string
  ) => { text: string; color: string; reason?: string; code?: string }[] | undefined
  tagDefinitions: TagDefinition[]
  actionBar: ReactNode
}

export const useProject = () => useOutletContext<ProjectContextValue>()

const formatSelectionTitle = (count: number, singleName?: string): string =>
  count === 1 && singleName ? `${singleName} selected` : `${count} codes selected`

export default function ProjectLayout() {
  const params = useParams<{ projectId: string; fileId?: string; searchId?: string }>()
  const navigate = useNavigate()
  const dismissSidebarRef = useRef<(() => void) | null>(null)
  const [activeNav, setActiveNav] = useState<ActiveNav>("documents")
  const [searchValue, setSearchValue] = useState("")
  const [exhibitSearchValue, setExhibitSearchValue] = useState("")
  const [docSortMode, setDocSortMode] = useState<DocSortMode>(() => getSettings().docSortMode)
  const [debugOptions, setDebugOptions] = useState<DebugOptions>(loadDebugOptions)
  const [loading, setLoading] = useState(true)
  const chatLoading = useSyncExternalStore(subscribeLoading, getLoading, getLoading)
  const [statusLabel, setStatusLabel] = useState("Connecting...")
  const [fileCount, setFileCount] = useState(0)
  const [totalFiles, setTotalFiles] = useState(0)
  const [dbSyncProcessed, setDbSyncProcessed] = useState(0)
  const [dbSyncTotal, setDbSyncTotal] = useState(0)
  const [embeddingProcessed, setEmbeddingProcessed] = useState(0)
  const [embeddingTotal, setEmbeddingTotal] = useState(0)
  const [topicProcessed, setTopicProcessed] = useState(0)
  const [topicTotal, setTopicTotal] = useState(0)
  useNotifications()

  useEffect(() => {
    saveDebugOptions(debugOptions)
  }, [debugOptions])

  useEffect(() => {
    setPersistEnabled(debugOptions.persistToServer)
  }, [debugOptions.persistToServer])

  useEffect(() => {
    setCacheSkipped(!!debugOptions.skipCache)
  }, [debugOptions.skipCache])

  const toggleDebugOption = useCallback(
    (key: string) => setDebugOptions((prev) => ({ ...prev, [key]: !prev[key] })),
    []
  )

  useEffect(() => {
    if (!params.projectId) return
    setProjectId(params.projectId)
    setPendingRefsSuppressed(true)

    let localFileCount = 0
    let localTotalFiles = 0
    let pendingRefsResolved = false
    let cancelled = false

    let filesLoadedResolve: (() => void) | null = null
    const filesLoadedPromise = new Promise<void>((r) => {
      filesLoadedResolve = r
    })

    const resolveIfFilesLoaded = () => {
      if (pendingRefsResolved) return
      if (localTotalFiles <= 0 || localFileCount < localTotalFiles) return
      pendingRefsResolved = true
      setPendingRefsSuppressed(false)
      resolvePendingRefsInBulk()
      filesLoadedResolve?.()
    }

    const trackAndApply = (command: Command) => {
      if (isSyncMetaCommand(command)) {
        localTotalFiles = command.fileCount
        setTotalFiles(command.fileCount)
      }
      applyCommand(command)
      if (isFileReceivedCommand(command)) {
        localFileCount++
        setFileCount(localFileCount)
        setStatusLabel("Loading files...")
      }
      resolveIfFilesLoaded()
    }

    const handleDbSyncProgress: OnDbSyncProgress = (processed, total) => {
      setDbSyncProcessed(processed)
      setDbSyncTotal(total)
      setStatusLabel("Syncing database...")
    }

    const connection = createWebSocket(params.projectId, {
      onCommand: trackAndApply,
    })

    const boot = async () => {
      startDatabase(handleDbSyncProgress)

      await filesLoadedPromise
      if (cancelled) return

      await waitForRequiredFiles()
      if (cancelled) return

      setStatusLabel("Syncing database...")
      await waitForDatabase()
      if (cancelled) return

      setStatusLabel("Understanding your content...")
      await startEmbeddings((processed, total) => {
        setEmbeddingProcessed(processed)
        setEmbeddingTotal(total)
      })
      if (cancelled) return
      setEmbeddingProcessed((t) => Math.max(t, 1))
      setEmbeddingTotal((t) => Math.max(t, 1))

      setStatusLabel("Classifying documents...")
      await startTopicAssignment((processed, total) => {
        setTopicProcessed(processed)
        setTopicTotal(total)
      })
      if (cancelled) return
      setTopicProcessed((t) => Math.max(t, 1))
      setTopicTotal((t) => Math.max(t, 1))

      setStatusLabel("Finalizing...")
      await syncOnce()
      startBackgroundSync()
      setLoading(false)
    }

    boot()

    return () => {
      cancelled = true
      connection.close()
      setProjectId(null)
      setPendingRefsSuppressed(false)
    }
  }, [params.projectId])

  const {
    files,
    currentFile,
    codebook,
    setCurrentFile,
    getFileTags,
    getFileDate: getFileDateFn,
    getFileAnnotations,
    tagDefinitions,
  } = useFiles()
  const fileImport = useFileImport()

  const availableFiles = useMemo(() => Object.keys(files).filter((f) => !isHiddenFile(f)), [files])

  const navigateToFirstFile = useCallback(() => {
    if (availableFiles.length === 0 || !params.projectId) return
    const first = availableFiles[0]
    setCurrentFile(first)
    navigate(`/project/${params.projectId}/file/${encodeURIComponent(first)}`, { replace: true })
  }, [availableFiles, params.projectId, setCurrentFile, navigate])

  useEffect(() => {
    if (loading) return

    if (params.searchId) {
      const searchExists = !!findSearchById(files, params.searchId)
      if (searchExists) {
        if (currentFile) setCurrentFile(null)
        return
      }
      navigateToFirstFile()
      return
    }

    if (params.fileId) {
      const decoded = decodeURIComponent(params.fileId)
      const fileExists = decoded in files
      if (fileExists) {
        if (decoded !== currentFile) setCurrentFile(decoded)
        return
      }
    }

    navigateToFirstFile()
  }, [
    loading,
    params.fileId,
    params.searchId,
    files,
    currentFile,
    setCurrentFile,
    navigateToFirstFile,
  ])

  const documents = useMemo(
    () => filesToSidebarDocuments(files, getFileTags, getFileDateFn, !!debugOptions.expanded),
    [files, getFileTags, getFileDateFn, debugOptions.expanded]
  )

  const exhibits = useMemo(() => collectExhibits(files), [files])

  const handleDocSortChange = useCallback((mode: DocSortMode) => {
    setDocSortMode(mode)
    setSetting("docSortMode", mode)
  }, [])

  const handleDocumentSelect = (filename: string) => {
    setCurrentFile(filename)
    dismissSidebarRef.current?.()
    navigate(`/project/${params.projectId}/file/${encodeURIComponent(filename)}`)
  }

  const resolveIds = useMemo(() => buildIdentifierResolver(files), [files])
  const recentSearches = useMemo(
    () => resolveSearchEntries(getRecentSearches(files), resolveIds),
    [files, resolveIds]
  )
  const savedSearches = useMemo(
    () => resolveSearchEntries(getSavedSearches(files), resolveIds),
    [files, resolveIds]
  )

  const handleSearchSave = (id: string) => {
    const entries = getSearchEntries(files)
    updateSearchEntries(toggleSearchSaved(entries, id))
  }

  const handleSearchRemove = (id: string) => {
    const entries = getSearchEntries(files)
    updateSearchEntries(removeSearch(entries, id))
  }

  const handleSearchSelect = (id: string) => {
    dismissSidebarRef.current?.()
    navigate(`/project/${params.projectId}/search/${id}`)
  }

  const handleEditCode = (code: Code) => {
    if (!params.projectId) return
    const documentId = findDocumentForCallout(files, code.id)
    if (!documentId) return
    dismissSidebarRef.current?.()
    navigate(
      `/project/${params.projectId}/file/${encodeURIComponent(documentId)}?entity=${code.id}`
    )
  }

  const handleExhibitSelect = (exhibit: ExhibitItem) => {
    if (!params.projectId) return
    dismissSidebarRef.current?.()
    navigate(
      `/project/${params.projectId}/file/${encodeURIComponent(exhibit.documentId)}?entity=${exhibit.id}`
    )
  }

  const selectedCodes = useMemo(() => getSelectedCodes(files), [files])
  const editorSelection = useEditorSelection()

  const isOnDocumentPage = !!params.fileId
  const isOnSearchPage = !!params.searchId
  const totalCodeCount = useMemo(() => getAllCodes(files).length, [files])
  const hasSelectedCodes = selectedCodes.size > 0
  const hasAllCodesSelected = selectedCodes.size >= totalCodeCount && totalCodeCount > 0
  const clearSelectedCodes = useCallback(() => writeSelectedCodes([]), [])
  const selectAllCodes = useCallback(
    () => writeSelectedCodes(getAllCodes(files).map((c) => c.id)),
    [files]
  )

  const fileAnnotationCount = useMemo(
    () => (currentFile ? getAnnotationCount(files[currentFile] ?? "") : undefined),
    [currentFile, files]
  )
  const annotationCounts = useMemo(
    () => (currentFile ? getAnnotationCountsByCode(getFileAnnotations(currentFile)) : {}),
    [currentFile, getFileAnnotations]
  )
  const globalAnnotationCounts = useMemo(() => getAnnotationGlobalCountsByCode(files), [files])
  const reviewStats = useMemo(() => getReviewStatsByCode(files), [files])

  const selectedAnnotationCountInFile = useMemo(() => {
    if (!currentFile) return 0
    const raw = files[currentFile]
    if (!raw) return 0
    return getStoredAnnotations(raw).filter((a) => a.code && selectedCodes.has(a.code) && !a.locked)
      .length
  }, [currentFile, files, selectedCodes])

  const handleClearCodings = useCallback(() => {
    if (!currentFile) return
    const raw = files[currentFile]
    if (!raw) return
    executeUxAction(clearCodingsPatches(currentFile, selectedCodes, getStoredAnnotations(raw)))
  }, [currentFile, selectedCodes, files])

  const filterAnnotationsBySelectedCodes = useCallback(
    (raw: string) => getStoredAnnotations(raw).filter((a) => a.code && selectedCodes.has(a.code)),
    [selectedCodes]
  )

  const annotationCountInSelection = useMemo(() => {
    if (!editorSelection?.filePath) return 0
    const resolved = resolveEditorSelection()
    if (!resolved) return 0
    const raw = files[resolved.filePath]
    if (!raw) return 0
    const annotations = filterAnnotationsBySelectedCodes(raw)
    return countAnnotationsInRange(
      { start: resolved.exact.startOffset, end: resolved.exact.endOffset },
      raw,
      annotations
    )
  }, [editorSelection, files, filterAnnotationsBySelectedCodes])

  const resolveActiveRanges = useCallback(() => {
    if (isOnSearchPage) return resolveSearchSelections()
    const range = resolveEditorSelection()
    return range ? [range] : []
  }, [isOnSearchPage])

  const handleClearSelection = useCallback(() => {
    const patches = resolveActiveRanges().flatMap((range) => {
      const raw = files[range.filePath]
      if (!raw) return []
      const annotations = filterAnnotationsBySelectedCodes(raw)
      const { ops } = buildClearSelectionOps(
        { start: range.exact.startOffset, end: range.exact.endOffset },
        raw,
        annotations
      )
      return ops.length > 0
        ? [{ path: range.filePath, language: "json-annotations" as const, ops }]
        : []
    })

    if (patches.length > 0) executeUxAction(patches)
  }, [files, filterAnnotationsBySelectedCodes, resolveActiveRanges])

  const handleCodeSelectedCodes = useCallback(() => {
    const refs = resolveCodingFiles(files, [...selectedCodes])
    if (refs.length > 0) dispatchTask(codeWithFiles(refs))
  }, [selectedCodes, files])

  const handleCodeSearchResults = useCallback(() => {
    if (!params.searchId) return
    const search = findSearchById(files, params.searchId)
    if (!search) return
    const refs = resolveCodingFiles(files, [...selectedCodes])
    if (refs.length > 0) dispatchTask(codeWithSearch(refs, params.searchId))
  }, [params.searchId, files, selectedCodes])

  const handleCodeSelection = useCallback(() => {
    const refs = resolveCodingFiles(files, [...selectedCodes])
    if (refs.length === 0) return

    if (isOnSearchPage && params.searchId) {
      const ranges = resolveSearchSelections()
      if (ranges.length === 0) return
      dispatchTask(codeWithSearchSelection(refs, ranges, params.searchId))
    } else {
      const range = resolveEditorSelection()
      if (!range) return
      dispatchTask(codeWithSelection(refs, [range]))
    }
  }, [files, selectedCodes, isOnSearchPage, params.searchId])

  const hasEditorSel = !!editorSelection?.filePath

  const formatClearLabel = (base: string, count: number): string =>
    count > 0 ? `${base} (${count})` : base

  const clearAction = useMemo((): ActionBarAction => {
    if (hasEditorSel) {
      return {
        icon: <Eraser />,
        label: formatClearLabel("Clear selection", annotationCountInSelection),
        onClick: handleClearSelection,
        variant: "confirm",
        disabled: annotationCountInSelection === 0,
      }
    }
    if (isOnDocumentPage) {
      return {
        icon: <Eraser />,
        label: selectedAnnotationCountInFile > 0 ? "Clear codings" : "Not coded",
        onClick: handleClearCodings,
        variant: "confirm",
        disabled: selectedAnnotationCountInFile === 0,
      }
    }
    return {
      icon: <Eraser />,
      label: "Clear selection",
      onClick: handleClearSelection,
      variant: "confirm",
      disabled: true,
    }
  }, [
    hasEditorSel,
    annotationCountInSelection,
    isOnDocumentPage,
    selectedAnnotationCountInFile,
    handleClearSelection,
    handleClearCodings,
  ])

  const codeSelectionActions = useMemo((): ActionBarAction[] => {
    const actions: ActionBarAction[] = [clearAction]

    if (isOnDocumentPage) {
      actions.push({
        icon: <FileText />,
        label: hasEditorSel ? "Code selection" : "Code file",
        onClick: hasEditorSel ? handleCodeSelection : handleCodeSelectedCodes,
        variant: "ai",
      })
    } else if (isOnSearchPage) {
      actions.push({
        icon: <FileText />,
        label: hasEditorSel ? "Code selection" : "Code results",
        onClick: hasEditorSel ? handleCodeSelection : handleCodeSearchResults,
        variant: "ai",
      })
    }

    if (selectedCodes.size === 1) {
      const codeId = [...selectedCodes][0]
      actions.push({
        icon: <Pencil />,
        label: "Refine Code",
        onClick: () => dispatchTask(buildRefineTask(codeId)),
        variant: "ai",
      })
    }

    return actions
  }, [
    clearAction,
    isOnDocumentPage,
    isOnSearchPage,
    hasEditorSel,
    handleCodeSelectedCodes,
    handleCodeSearchResults,
    handleCodeSelection,
    selectedCodes,
  ])

  const handleSearchCode = (code: Code) => {
    const id = saveNewSearch({
      title: code.id,
      description: `Passages coded as: ${code.id}`,
      sql: `SELECT file, id, text FROM annotations WHERE code = '${code.id}'`,
    })
    if (!id) return
    writeSelectedCodes([code.id])
    dismissSidebarRef.current?.()
    navigate(`/project/${params.projectId}/search/${id}`)
  }

  const handleSearchCodeInFile = (code: Code) => {
    if (!currentFile) return
    const id = saveNewSearch({
      title: `${code.id} in file`,
      description: `Passages coded as: ${code.id} in ${currentFile}`,
      sql: `SELECT file, id, text FROM annotations WHERE code = '${code.id}' AND file = '${currentFile}'`,
    })
    if (!id) return
    writeSelectedCodes([code.id])
    dismissSidebarRef.current?.()
    navigate(`/project/${params.projectId}/search/${id}`)
  }

  const handleSearchUnsure = (code: Code) => {
    const id = saveNewSearch(buildFlaggedSearch(code.id, code.id))
    if (!id) return
    writeSelectedCodes([code.id])
    dismissSidebarRef.current?.()
    navigate(`/project/${params.projectId}/search/${id}`)
  }

  const handleFindCandidates = (code: Code) => {
    if (code.detail.trim().length === 0) return
    const id = saveNewSearch(buildCandidateSearch(code.id))
    if (!id) return
    writeSelectedCodes([code.id])
    dismissSidebarRef.current?.()
    navigate(`/project/${params.projectId}/search/${id}`)
  }

  const handleCodeFile = (code: Code) => {
    const refs = resolveCodingFiles(files, [code.id])
    if (refs.length > 0) dispatchTask(codeWithFiles(refs))
  }

  const sidebarPanels = {
    documents: (
      <DocumentsSidebar
        documents={documents}
        selectedId={currentFile ?? undefined}
        searchValue={searchValue}
        sortMode={docSortMode}
        tagDefinitions={[...tagDefinitions, HIDDEN_TAG]}
        onSearchChange={setSearchValue}
        onSortChange={handleDocSortChange}
        onDocumentSelect={handleDocumentSelect}
        onNewDocument={() => undefined}
      />
    ),
    exhibits: (
      <ExhibitsSidebar
        exhibits={exhibits}
        searchValue={exhibitSearchValue}
        onSearchChange={setExhibitSearchValue}
        onExhibitSelect={handleExhibitSelect}
        onNew={() => undefined}
      />
    ),
    search: (
      <SearchSidebar
        recentSearches={recentSearches}
        savedSearches={savedSearches}
        selectedId={params.searchId}
        onSave={handleSearchSave}
        onRemove={handleSearchRemove}
        onSelect={handleSearchSelect}
      />
    ),
    ...(codebook
      ? {
          codes: (
            <CodesSidebar
              codebook={codebook}
              annotationCounts={annotationCounts}
              globalAnnotationCounts={globalAnnotationCounts}
              reviewStats={reviewStats}
              debugReview={debugOptions.showReviewStats}
              busy={chatLoading}
              allSelected={hasAllCodesSelected}
              onSelectAll={selectAllCodes}
              onDeselectAll={clearSelectedCodes}
              onEditCode={handleEditCode}
              onCodeFile={handleCodeFile}
              onFileSelect={handleDocumentSelect}
              onSearchCode={handleSearchCode}
              onSearchCodeInFile={handleSearchCodeInFile}
              onSearchUnsure={handleSearchUnsure}
              onFindCandidates={handleFindCandidates}
            />
          ),
        }
      : {}),
  }

  const fileProgress = computeFileProgress(fileCount, totalFiles)
  const dbProgress = computeWeightedProgress(dbSyncProcessed, dbSyncTotal, DB_WEIGHT)
  const embeddingsProgress = computeWeightedProgress(
    embeddingProcessed,
    embeddingTotal,
    EMBEDDING_WEIGHT
  )
  const topicsProgress = computeWeightedProgress(topicProcessed, topicTotal, TOPIC_WEIGHT)
  const totalProgress = fileProgress + dbProgress + embeddingsProgress + topicsProgress

  return (
    <NabuProvider key={params.projectId}>
      {loading && (
        <div className="fixed inset-0 z-[100]">
          <WelcomeBackLoading progress={totalProgress} statusLabel={statusLabel} />
        </div>
      )}
      <div {...fileImport.dragHandlers} className="contents">
        <DefaultPageLayout
          activeNav={activeNav}
          showCodes={!!codebook}
          showExhibits={exhibits.length > 0}
          annotationCount={fileAnnotationCount}
          onNavChange={setActiveNav}
          dismissSidebarRef={dismissSidebarRef}
          sidebarPanels={sidebarPanels}
          sidebarFooterExtra={
            <DebugMenuButton
              debugOptions={debugOptions}
              onToggleOption={toggleDebugOption}
              onRequestCompaction={requestCompaction}
            />
          }
          rightPanel={<NabuChatSidebar appReady={!loading} />}
        >
          <div className="flex h-full w-full items-start bg-default-background">
            <div className="flex grow shrink-0 basis-0 flex-col items-start self-stretch">
              <Outlet
                context={{
                  files,
                  currentFile,
                  dbReady: !loading,
                  debugOptions,
                  toggleDebugOption,
                  requestCompaction,
                  getFileTags,
                  getFileDate: getFileDateFn,
                  getFileAnnotations,
                  tagDefinitions,
                  actionBar:
                    (isOnDocumentPage || isOnSearchPage) && hasSelectedCodes ? (
                      <ActionBar
                        title={formatSelectionTitle(
                          selectedCodes.size,
                          selectedCodes.size === 1
                            ? findCodeById(files, [...selectedCodes][0])?.title
                            : undefined
                        )}
                        actions={codeSelectionActions}
                      />
                    ) : null,
                }}
              />
            </div>
          </div>
          {debugOptions.showStreamPanel && (
            <DebugStreamPanel onClose={() => toggleDebugOption("showStreamPanel")} />
          )}
        </DefaultPageLayout>
        <FileDropOverlay
          isVisible={fileImport.isVisible}
          isDragging={fileImport.isDragging}
          files={fileImport.files}
          progress={fileImport.progress}
          isProcessing={fileImport.isProcessing}
          dragHandlers={fileImport.dragHandlers}
          onDismiss={fileImport.dismiss}
        />
      </div>
    </NabuProvider>
  )
}
