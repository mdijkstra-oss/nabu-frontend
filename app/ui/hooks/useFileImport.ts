import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { processFiles } from "~/lib/import/process"
import { isMarkdownFile } from "~/lib/import/read"
import { readDroppedItems } from "~/lib/import/folder"
import { subscribeEngineEvents } from "~/domain/engine/init"
import {
  emptyImportRows,
  addRows,
  applyImportStatus,
  applyEngineEvent,
  deriveProgress,
} from "./fileImportRows"
import type { ImportRows } from "./fileImportRows"
import type { EngineEvent } from "~/lib/engine/types"
import type { ImportFile, ImportStatus } from "~/lib/import/types"

export const useFileImport = () => {
  // React batches setState, so the authoritative state lives in a ref written
  // synchronously as processFiles reports finalPath — an engine event emitted in
  // the same tick as the store write must find its row. State mirrors it to render.
  const rowsRef = useRef<ImportRows>(emptyImportRows)
  const [rowsState, setRowsState] = useState<ImportRows>(emptyImportRows)
  const [isDragging, setIsDragging] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const dragCounterRef = useRef(0)

  const commit = useCallback((next: ImportRows) => {
    rowsRef.current = next
    setRowsState(next)
  }, [])

  const files = useMemo(() => Object.values(rowsState.rows), [rowsState])

  const hasFiles = files.length > 0

  const progress = useMemo(() => deriveProgress(files), [files])

  const isProcessing = progress.total > 0 && progress.processed < progress.total

  const updateFileStatus = useCallback(
    (id: string, status: ImportStatus, extra?: Partial<ImportFile>) => {
      commit(applyImportStatus(rowsRef.current, id, status, extra))
    },
    [commit]
  )

  const handleEngineEvent = useCallback(
    (event: EngineEvent) => {
      const next = applyEngineEvent(rowsRef.current, event)
      if (next !== rowsRef.current) commit(next)
    },
    [commit]
  )

  useEffect(() => {
    if (!hasFiles) return
    return subscribeEngineEvents(handleEngineEvent)
  }, [hasFiles, handleEngineEvent])

  const addFiles = useCallback(
    async (dropped: File[]) => {
      if (dropped.length === 0) return

      commit(addRows(rowsRef.current, dropped))

      const markdownFiles = dropped.filter((file) => isMarkdownFile(file.name))
      await processFiles(markdownFiles, updateFileStatus)
    },
    [commit, updateFileStatus]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDragging(true)
      setIsVisible(true)
    }
  }, [])

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current--
      if (dragCounterRef.current === 0) {
        setIsDragging(false)
        if (!hasFiles) setIsVisible(false)
      }
    },
    [hasFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragging(false)

      const dropped = await readDroppedItems(e.dataTransfer)
      if (dropped.length > 0) {
        addFiles(dropped)
      }
    },
    [addFiles]
  )

  const dismiss = useCallback(() => {
    setIsVisible(false)
    commit(emptyImportRows)
  }, [commit])

  useEffect(() => {
    if (!isVisible && !hasFiles) {
      dragCounterRef.current = 0
    }
  }, [isVisible, hasFiles])

  const dragHandlers = {
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  }

  return {
    files,
    hasFiles,
    isDragging,
    isVisible,
    isProcessing,
    progress,
    addFiles,
    dismiss,
    dragHandlers,
  }
}
