"use client"

import { useMemo, memo } from "react"
import Markdown from "react-markdown"
import { createEntityLinkComponents } from "~/ui/components/markdown/createEntityLinkComponents"
import { linkifyEntityIds } from "~/lib/markdown/linkify/entities"
import { linkifyQuotes } from "~/lib/markdown/linkify/quotes"
import { normalizeBacktickQuotes } from "~/lib/markdown/sanitize/normalize-backticks"
import { resolveEntityName } from "~/lib/files/selectors"
import { boldMissingFile } from "~/lib/files/filename"
import { stripHiddenSuffix, stripEntityQuotes } from "~/lib/markdown/sanitize/strip-hidden"
import { stripEntityLinks } from "~/lib/markdown/sanitize/strip-entity-links"

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
        {linkifyQuotes(
          normalizeBacktickQuotes(
            linkifyEntityIds(
              stripEntityLinks(stripEntityQuotes(stripHiddenSuffix(children))),
              (id) => resolveEntityName(files, id),
              boldMissingFile
            )
          ),
          currentFile,
          currentFileContent
        )}
      </Markdown>
    )
  }
)
