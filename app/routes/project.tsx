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
import { DocumentsSidebar } from "~/ui/components/sidebar/documents/DocumentsSidebar"
import {
  buildDocumentEntries,
  type DocumentEntry,
  type DocSortMode,
} from "~/domain/documents/selectors"
import { CodesSidebar } from "~/ui/components/sidebar/codes/CodesSidebar"
import type { Code } from "~/ui/components/sidebar/codes/types"
import { ExhibitsSidebar } from "~/ui/components/sidebar/exhibits/ExhibitsSidebar"
import { getLatestSearch } from "~/domain/data-blocks/settings/searches/selectors"
import { saveNewSearch } from "~/lib/agent/tools/search/settings"
import { NabuProvider } from "~/ui/components/nabu/context"
import { NabuChatSidebar } from "~/ui/components/nabu/NabuChatSidebar"
import { DebugMenuButton } from "~/ui/components/debug/DebugMenuButton"
import { DebugStreamPanel } from "~/ui/components/debug/DebugStreamPanel"
import { FileDropOverlay } from "~/ui/components/import/FileDropOverlay"
import { useNotifications } from "~/ui/hooks/useNotifications"
import { DEFAULT_DEBUG_OPTIONS, type DebugOptions } from "~/ui/components/editor/debug-config"
import { publishDebugOptions } from "~/lib/debug/options"
import { setCacheSkipped } from "~/lib/utils/storage-cache"
import { setShowModelIndex } from "~/lib/agent/tools/apply-deep-analysis/debug-flags"

import { createWebSocket } from "~/lib/server/sync/websocket"
import { applyCommand } from "~/lib/server/sync/apply"
import type { Command } from "~/lib/server/sync/types"
import {
  setProjectId,
  setPersistEnabled,
  setPendingRefsSuppressed,
  resolvePendingRefsInBulk,
  auditPendingRefsAtBoot,
  waitForRequiredFiles,
  getFiles,
  updateFileRaw,
} from "~/lib/files/store"
import {
  startDatabase,
  waitForDatabase,
  syncOnce,
  startBackgroundSync,
  type OnDbSyncProgress,
} from "~/domain/db/database"
import { startEmbeddings } from "~/domain/embeddings/init"
import { startBm25 } from "~/domain/search/bm25-init"
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
import { isHiddenFile, nextUntitledFilename } from "~/lib/files/filename"
import { HIDDEN_TAG } from "~/domain/data-blocks/settings/tags/hidden"
import { findSearchById } from "~/domain/data-blocks/settings/searches/selectors"
import {
  buildFlaggedSearch,
  buildCandidateSearch,
  buildFileCandidateSearch,
} from "~/domain/search/queries"
import { collectExhibits } from "~/domain/exhibits/selectors"
import type { ExhibitItem } from "~/domain/exhibits/types"
import { getSettings, setSetting } from "~/lib/storage"
import { dispatchTask } from "~/lib/agent/dispatch"
import {
  buildRefineTask,
  codeWithFiles,
  codeFiles,
  codeWithSearch,
  codeWithSelection,
  codeWithSearchSelection,
} from "~/domain/actions/coding/actions"
import { resolveCodingFiles } from "~/domain/actions/coding/selectors"
import { isSelectionSearch, parseSelectionOrder } from "~/domain/search/selection-search"
import { useEditorSelection } from "~/ui/hooks/useEditorSelection"
import { resolveEditorSelection, resolveSearchSelections } from "~/lib/editor/selection-context"
import { clearCodingsPatches } from "~/domain/actions/clear-codings/apply"
import { executeUxAction } from "~/lib/data-blocks/file-action"
import { countAnnotationsInRange, buildClearSelectionOps } from "~/lib/editor/annotations/merge"
import { getLoading, subscribeLoading } from "~/lib/agent/client/store"
import { ActionBar, type ActionBarAction } from "~/ui/components/FloatingActionBar"
import { pointAt, clearPointing } from "~/lib/ui/pointing"
import { getSelectedCodes, getSelectedDocs } from "~/domain/data-blocks/ux/selectors"
import { writeSelectedCodes } from "~/domain/actions/select-codes/apply"
import { getAllCodes, findCodeById } from "~/domain/data-blocks/callout/codes/selectors"

export type { DebugOptions } from "~/ui/components/editor/debug-config"

const DEBUG_STORAGE_KEY = "nabu-debug-options"

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

const isSyncMetaCommand = (command: Command): command is Command & { fileCount: number } =>
  command.action === "SyncMeta" && typeof command.fileCount === "number"

const isFileReceivedCommand = (command: Command): boolean => command.action === "WriteFile"

const FILE_WEIGHT = 35
const DB_WEIGHT = 40
const EMBEDDING_WEIGHT = 10
const TOPIC_WEIGHT = 15

const computeFileProgress = (loaded: number, total: number): number => {
  if (loaded === 0) return 0
  if (total === 0) return Math.min(FILE_WEIGHT - 5, loaded * 2)
  return Math.round((loaded / total) * FILE_WEIGHT)
}

const formatCodeFilesLabel = (count: number): string =>
  count > 1 ? `Code ${count} files` : "Code file"

const computeWeightedProgress = (processed: number, total: number, weight: number): number =>
  total === 0 ? 0 : Math.round((processed / total) * weight)

export interface ProjectContextValue {
  files: Record<string, string>
  currentFile: string | null
  dbReady: boolean
  debugOptions: DebugOptions
  toggleDebugOption: (key: string) => void
  getFileTags: (filename: string) => string[]
  getFileDate: (filename: string) => string | undefined
  getFileAnnotations: (
    filename: string
  ) => { text: string; color: string; reason?: string; code?: string }[] | undefined
  tagDefinitions: TagDefinition[]
  documents: DocumentEntry[]
  docSortMode: DocSortMode
  onDocSortChange: (mode: DocSortMode) => void
  onSelectDocument: (filename: string) => void
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
  const [debugOptions, setDebugOptions] = useState<DebugOptions>(() => {
    const opts = loadDebugOptions()
    publishDebugOptions(opts)
    return opts
  })
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
    publishDebugOptions(debugOptions)
  }, [debugOptions])

  useEffect(() => {
    setPersistEnabled(debugOptions.persistToServer)
  }, [debugOptions.persistToServer])

  useEffect(() => {
    setCacheSkipped(!!debugOptions.skipCache)
  }, [debugOptions.skipCache])

  useEffect(() => {
    setShowModelIndex(!!debugOptions.showModelIndex)
  }, [debugOptions.showModelIndex])

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
      auditPendingRefsAtBoot()
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

      await startBm25()
      if (cancelled) return

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
      // A rename drops the URL's file from the store before the navigation to
      // the new name lands; renameFile has already moved currentFile there, so
      // follow it instead of bouncing to the first file.
      if (currentFile && currentFile in files) {
        navigate(`/project/${params.projectId}/file/${encodeURIComponent(currentFile)}`, {
          replace: true,
        })
        return
      }
    }

    navigateToFirstFile()
  }, [
    loading,
    params.fileId,
    params.searchId,
    params.projectId,
    files,
    currentFile,
    setCurrentFile,
    navigate,
    navigateToFirstFile,
  ])

  const documents = useMemo(
    () => buildDocumentEntries(files, getFileTags, getFileDateFn, !!debugOptions.expanded),
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

  const handleNewDocument = () => {
    // getFiles() over the hook snapshot: the store notifies debounced, so the
    // snapshot can lag and hand out an already-taken name.
    const filename = nextUntitledFilename(Object.keys(getFiles()))
    updateFileRaw(filename, "# Untitled\n")
    handleDocumentSelect(filename)
  }

  const latestSearch = useMemo(() => getLatestSearch(files), [files])

  const handleNavChange = useCallback(
    (nav: ActiveNav) => {
      if (nav === "search") {
        dismissSidebarRef.current?.()
        if (latestSearch) navigate(`/project/${params.projectId}/search/${latestSearch.id}`)
        return
      }
      setActiveNav(nav)
    },
    [latestSearch, navigate, params.projectId]
  )

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
  const selectedDocs = useMemo(() => getSelectedDocs(files), [files])
  const editorSelection = useEditorSelection()

  const isOnDocumentPage = !!params.fileId
  const isOnSearchPage = !!params.searchId
  const filesToCode = useMemo(
    () =>
      [...new Set([currentFile, ...selectedDocs])].filter((f): f is string => !!f && f in files),
    [currentFile, selectedDocs, files]
  )
  const searchSelectionDocs = useMemo(() => {
    if (!isOnSearchPage || !params.searchId) return null
    const search = findSearchById(files, params.searchId)
    if (!search || !isSelectionSearch(search)) return null
    return parseSelectionOrder(search).filter((f) => f in files)
  }, [isOnSearchPage, params.searchId, files])
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
    const dimensions = resolveCodingFiles(files, [...selectedCodes])
    if (dimensions.length === 0 || filesToCode.length === 0) return
    dispatchTask(codeFiles(filesToCode, dimensions))
  }, [selectedCodes, files, filesToCode])

  const handleCodeSearchResults = useCallback(() => {
    if (!params.searchId) return
    const search = findSearchById(files, params.searchId)
    if (!search) return
    const refs = resolveCodingFiles(files, [...selectedCodes])
    if (refs.length === 0) return
    if (isSelectionSearch(search)) {
      const docs = parseSelectionOrder(search).filter((f) => f in files)
      if (docs.length > 0) dispatchTask(codeFiles(docs, refs))
      return
    }
    dispatchTask(codeWithSearch(refs, params.searchId))
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
        label: hasEditorSel ? "Code selection" : formatCodeFilesLabel(filesToCode.length),
        onClick: hasEditorSel ? handleCodeSelection : handleCodeSelectedCodes,
        variant: "ai",
      })
    } else if (isOnSearchPage) {
      actions.push({
        icon: <FileText />,
        label: hasEditorSel
          ? "Code selection"
          : searchSelectionDocs
            ? formatCodeFilesLabel(searchSelectionDocs.length)
            : "Code results",
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
    filesToCode,
    searchSelectionDocs,
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

  const handleFindFileCandidates = (code: Code) => {
    if (!currentFile || code.detail.trim().length === 0) return
    const id = saveNewSearch(buildFileCandidateSearch(code.id, currentFile))
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
        onNewDocument={handleNewDocument}
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
              onFindFileCandidates={
                currentFile && debugOptions.fileSpecificCandidates
                  ? handleFindFileCandidates
                  : undefined
              }
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
          showSearch={!!latestSearch}
          annotationCount={fileAnnotationCount}
          onNavChange={handleNavChange}
          dismissSidebarRef={dismissSidebarRef}
          sidebarPanels={sidebarPanels}
          sidebarFooterExtra={
            <DebugMenuButton debugOptions={debugOptions} onToggleOption={toggleDebugOption} />
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
                  getFileTags,
                  getFileDate: getFileDateFn,
                  getFileAnnotations,
                  tagDefinitions,
                  documents,
                  docSortMode,
                  onDocSortChange: handleDocSortChange,
                  onSelectDocument: handleDocumentSelect,
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
                        onTitleHover={(h) => (h ? pointAt(["nav:codes"]) : clearPointing())}
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
