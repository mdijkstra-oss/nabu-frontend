"use client"

import { useEffect, type ReactNode } from "react"
import { setPageContext, CONTEXT_PREFIX } from "~/lib/editor/chat-context"
import { getCurrentFile, getFileRaw } from "~/lib/files/store"
import { isHiddenFile } from "~/lib/files/filename"
import { getEditorSelection } from "~/lib/editor/selection-store"
import { formatSelectionContext } from "~/lib/editor/selection-context"

interface NabuProviderProps {
  children: ReactNode
}

const buildSelectionSegment = (file: string): string | null => {
  const selection = getEditorSelection()
  if (!selection) return null
  const raw = getFileRaw(file)
  if (!raw) return null
  return formatSelectionContext(selection, raw)
}

const buildFileContextMessage = (): string | null => {
  const file = getCurrentFile()
  if (!file || isHiddenFile(file)) return null
  const parts = [CONTEXT_PREFIX, `Document: ${file} (${file})`]
  const selectionContext = buildSelectionSegment(file)
  if (selectionContext) parts.push(selectionContext)
  return parts.join("\n")
}

export const NabuProvider = ({ children }: NabuProviderProps) => {
  useEffect(() => {
    setPageContext(buildFileContextMessage)
    return () => setPageContext(undefined)
  }, [])

  return <>{children}</>
}
