"use client"

import { useMemo, memo } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { createEntityLinkComponents } from "~/ui/components/markdown/createEntityLinkComponents"
import { summarizeMiddle } from "~/lib/text/summarize"
import type { EntityKind } from "~/lib/markdown/linkify/types"
import { linkifyTags } from "~/lib/markdown/linkify/tags"
import { fixMarkdownUrls } from "~/lib/markdown/sanitize/fix-urls"
import {
  findTagDefinitionByLabel,
  getTagDisplay,
} from "~/domain/data-blocks/settings/tags/selectors"
import { resolveEntityName } from "~/lib/files/selectors"
import { truncateLabel } from "~/lib/mutation-history/presentation"
import { prepareEntityMarkdown } from "~/lib/markdown/prepare"

export interface ChatEntityContext {
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate: (url: string) => void
}

export interface MessageContentProps {
  content: string
  context: ChatEntityContext
}

export const allowFileProtocol = (url: string): string => url

export const prepareChatMarkdown = (content: string, context: ChatEntityContext): string =>
  fixMarkdownUrls(
    linkifyTags(
      prepareEntityMarkdown(
        content,
        (id) => resolveAndTruncateName(context.files, id),
        context.currentFile,
        context.currentFileContent
      ),
      (label) => resolveTagForLinkify(context.files, label)
    )
  )

export const createChatLinkComponents = (context: ChatEntityContext) =>
  createEntityLinkComponents({
    files: context.files,
    projectId: context.projectId,
    navigate: context.navigate,
    transformLabel: summarizeAnnotationLabel,
  })

export const MessageContent = memo(({ content, context }: MessageContentProps) => {
  const components = useMemo(
    () => ({ ...createChatLinkComponents(context), table: ScrollableTable }),
    [context]
  )
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      components={components}
      urlTransform={allowFileProtocol}
    >
      {prepareChatMarkdown(content, context)}
    </Markdown>
  )
})

const remarkPlugins = [remarkGfm]

const resolveAndTruncateName = (files: Record<string, string>, id: string): string | null => {
  const name = resolveEntityName(files, id)
  return name ? truncateLabel(name) : null
}

const resolveTagForLinkify = (
  files: Record<string, string>,
  label: string
): { id: string; display: string } | null => {
  const def = findTagDefinitionByLabel(files, label)
  return def ? { id: def.id, display: getTagDisplay(def) } : null
}

const summarizeAnnotationLabel = (label: string, kind: EntityKind): string =>
  kind === "annotation" ? summarizeMiddle(label) : label

const ScrollableTable = ({
  _node,
  ...props
}: React.ComponentProps<"table"> & { _node?: unknown }) => (
  <div className="overflow-x-auto">
    <table {...props} />
  </div>
)
