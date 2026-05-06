"use client"

import { useEffect, type ReactNode } from "react"
import { setPageContext, CONTEXT_PREFIX } from "~/lib/editor/chat-context"
import { getCurrentFile } from "~/lib/files/store"
import { isHiddenFile } from "~/lib/files/filename"

interface NabuProviderProps {
  children: ReactNode
}

const buildFileContextMessage = (): string | null => {
  const file = getCurrentFile()
  if (!file || isHiddenFile(file)) return null
  return [CONTEXT_PREFIX, `Document: ${file} (${file})`].join("\n")
}

export const NabuProvider = ({ children }: NabuProviderProps) => {
  useEffect(() => {
    setPageContext(buildFileContextMessage)
    return () => setPageContext(undefined)
  }, [])

  return <>{children}</>
}
