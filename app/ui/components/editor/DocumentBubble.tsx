"use client"

import { useCallback, useRef } from "react"
import { useEditorSelection } from "~/ui/hooks/useEditorSelection"
import { useScrollToEntity } from "~/ui/hooks/useScrollToEntity"
import { toDisplayName } from "~/lib/files/filename"
import { consumeTitleEdit, useTitleEditRequested } from "~/lib/ui/title-edit"
import { MilkdownEditor } from "./MilkdownEditor"
import { ScrollGutter } from "./ScrollGutter"
import { ScrollShadow } from "~/ui/components/ScrollShadow"
import { FileHeader, type MenuItem } from "./FileHeader"
import { StatusBar } from "~/ui/components/StatusBar"
import {
  computeTextStats,
  countLines,
  formatStatsLabel,
  formatStatsDetail,
  formatSelectionSuffix,
} from "~/lib/text/stats"
import { stripSingletonBlocks } from "~/lib/data-blocks/registry"
import {
  getDocumentType,
  getDocumentSubject,
} from "~/domain/data-blocks/attributes/topics/selectors"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import type { Spotlight } from "~/lib/editor/spotlight/types"
import type { RegionSearchHandler } from "~/lib/editor/regions/plugin"
import type { DebugOptions } from "./debug-config"
import { cn } from "~/ui/utils"

interface DocumentBubbleProps {
  filename: string
  content: string
  tags: TagDefinition[]
  date?: string
  readOnly?: boolean
  headerOnly?: boolean
  headerClassName?: string
  debugMode?: boolean
  debugOptions?: DebugOptions
  spotlight?: Spotlight | Spotlight[] | null
  menuGroups?: MenuItem[][]
  availableTags?: TagDefinition[]
  onToggleTag?: (tagId: string, enabled: boolean) => void
  onClick?: () => void
  onChange?: (markdown: string) => void
  onRegionSearch?: RegionSearchHandler
  onRenameTitle?: (title: string) => void
  className?: string
}

export const DocumentBubble = ({
  filename,
  content,
  tags,
  date,
  readOnly = false,
  headerOnly = false,
  headerClassName,
  debugMode = false,
  debugOptions,
  spotlight = null,
  menuGroups = [],
  availableTags,
  onToggleTag,
  onClick,
  onChange,
  onRegionSearch,
  onRenameTitle,
  className,
}: DocumentBubbleProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const editorSelection = useEditorSelection()
  useScrollToEntity(editorContainerRef, readOnly ? null : filename)

  const renameRequested = useTitleEditRequested(filename)
  const settleRenameRequest = useCallback(() => {
    consumeTitleEdit(filename)
  }, [filename])

  const handleScrollTo = useCallback((percent: number) => {
    const container = scrollContainerRef.current
    if (!container) return
    const maxScroll = container.scrollHeight - container.clientHeight
    container.scrollTo({ top: (percent / 100) * maxScroll, behavior: "smooth" })
  }, [])

  const statusText = readOnly
    ? documentStatusText(content)
    : `${documentStatusText(content)}${formatSelectionSuffix(editorSelection?.text)}`

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex h-full w-full min-h-0 flex-col overflow-hidden rounded-xl border border-solid border-panel-border bg-default-background",
        onClick && "cursor-pointer",
        className
      )}
    >
      <FileHeader
        title={toDisplayName(filename)}
        date={date}
        tags={tags}
        menuGroups={menuGroups}
        availableTags={availableTags}
        onToggleTag={onToggleTag}
        onRename={readOnly || headerOnly ? undefined : onRenameTitle}
        renameRequested={renameRequested}
        onRenameSettled={settleRenameRequest}
        className={headerClassName}
      />
      {headerOnly ? (
        <div className="grow min-h-0" />
      ) : readOnly ? (
        <div className="flex w-full grow min-h-0 flex-col items-start overflow-hidden pl-12 pr-6 py-6">
          <MilkdownEditor
            key={`${filename}-${debugMode}`}
            content={formatContent(content, filename)}
            debugMode={debugMode}
            debugOptions={debugOptions}
            readOnly
            spotlight={spotlight}
            filePath={filename}
          />
        </div>
      ) : (
        <div className="flex w-full grow shrink basis-0 min-h-0 items-stretch">
          <ScrollShadow
            scrollRef={scrollContainerRef}
            className="flex-col items-start pl-12 pr-6 py-6"
          >
            <div
              ref={editorContainerRef}
              className="relative flex w-full grow flex-col items-start gap-8"
            >
              <MilkdownEditor
                key={`${filename}-${debugMode}`}
                content={formatContent(content, filename)}
                debugMode={debugMode}
                debugOptions={debugOptions}
                spotlight={spotlight}
                filePath={filename}
                onRegionSearch={onRegionSearch}
                // JSON files are shown wrapped in a code fence (formatContent), so
                // their serialized markdown is not the raw file — never write it back.
                onChange={isJsonFile(filename) ? undefined : onChange}
              />
            </div>
          </ScrollShadow>
          <ScrollGutter
            contentRef={editorContainerRef}
            scrollContainerRef={scrollContainerRef}
            onScrollTo={handleScrollTo}
          />
        </div>
      )}
      {!headerOnly && (
        <div className="flex-none bg-default-background">
          <StatusBar
            text={statusText}
            tooltip={readOnly ? undefined : documentStatusTooltip(content)}
          />
        </div>
      )}
    </div>
  )
}

const isJsonFile = (filename: string): boolean => filename.endsWith(".json")

const wrapAsCodeBlock = (content: string, lang: string): string =>
  `\`\`\`${lang}\n${content}\n\`\`\``

const formatContent = (content: string, filename: string): string =>
  isJsonFile(filename) ? wrapAsCodeBlock(content, "json") : content

const formatClassificationLine = (
  type: string | undefined,
  subject: string | undefined
): string | null => {
  const parts = [type, subject].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : null
}

const documentStatusText = (content: string): string =>
  formatStatsLabel(computeTextStats(stripSingletonBlocks(content)))

const documentStatusTooltip = (content: string): string => {
  const stripped = stripSingletonBlocks(content)
  const totalLines = countLines(content)
  const proseLines = countLines(stripped)
  const stats = computeTextStats(stripped)
  const linesLabel =
    totalLines === proseLines
      ? `${totalLines.toLocaleString()} lines`
      : `${proseLines.toLocaleString()} lines (${totalLines.toLocaleString()} with data blocks)`
  const detail = `${linesLabel} · ${formatStatsDetail(stats)}`
  const classification = formatClassificationLine(
    getDocumentType(content),
    getDocumentSubject(content)
  )
  return classification ? `${detail}\n${classification}` : detail
}
