"use client"

import { useMemo, memo } from "react"
import Markdown from "react-markdown"
import { createEntityLinkComponents } from "~/ui/components/markdown/createEntityLinkComponents"
import { resolveEntityName } from "~/lib/files/selectors"
import { prepareEntityMarkdown } from "~/lib/markdown/prepare"

const allowFileProtocol = (url: string) => url

const InlineP = ({ children }: { children?: React.ReactNode }) => <span>{children}</span>

interface InlineMarkdownProps {
  children: string
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}

export const InlineMarkdown = memo(
  ({
    children,
    files,
    projectId,
    currentFile,
    currentFileContent,
    navigate,
  }: InlineMarkdownProps) => {
    const components = useMemo(
      () => ({
        ...createEntityLinkComponents({ files, projectId, navigate }),
        p: InlineP,
      }),
      [files, projectId, navigate]
    )
    return (
      <Markdown components={components} urlTransform={allowFileProtocol}>
        {prepareEntityMarkdown(
          children,
          (id) => resolveEntityName(files, id),
          currentFile,
          currentFileContent
        )}
      </Markdown>
    )
  }
)
