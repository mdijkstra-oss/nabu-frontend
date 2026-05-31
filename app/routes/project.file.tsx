import { useCallback, useMemo, useRef } from "react"
import { useEditorSelection } from "~/ui/hooks/useEditorSelection"
import { AnimatePresence } from "framer-motion"
import { useSearchParams } from "react-router"
import { useScrollToEntity } from "~/ui/hooks/useScrollToEntity"
import { parseSpotlight } from "~/lib/editor/spotlight/parse"
import { patchBlock } from "~/lib/data-blocks/patch"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { useProject } from "./project"
import { toDisplayName } from "~/lib/files/filename"
import { MilkdownEditor } from "~/ui/components/editor/MilkdownEditor"
import { ScrollGutter } from "~/ui/components/editor/ScrollGutter"
import { FileHeader } from "~/ui/components/editor/FileHeader"
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
import { Clipboard, Copy, FileText, Share2, Trash } from "lucide-react"

const formatClassificationLine = (
  type: string | undefined,
  subject: string | undefined
): string | null => {
  const parts = [type, subject].filter(Boolean)
  return parts.length > 0 ? parts.join(" \u00b7 ") : null
}

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

const documentStatusText = (content: string): string =>
  formatStatsLabel(computeTextStats(stripSingletonBlocks(content)))

const sortTagsByDisplay = (tags: TagDefinition[]): TagDefinition[] =>
  [...tags].sort((a, b) => a.display.localeCompare(b.display))

const getFileRaw = (files: Record<string, string>, filename: string): string | undefined =>
  files[filename]

const isJsonFile = (filename: string): boolean => filename.endsWith(".json")

const ATTRIBUTES_LANGUAGE = "json-attributes"

const removeTagOp = (allTagIds: string[], tagId: string) => [
  { op: "replace" as const, path: "/tags", value: allTagIds.filter((id) => id !== tagId) },
]

const wrapAsCodeBlock = (content: string, lang: string): string =>
  `\`\`\`${lang}\n${content}\n\`\`\``

const formatContent = (content: string, filename: string): string =>
  isJsonFile(filename) ? wrapAsCodeBlock(content, "json") : content

export default function ProjectFile() {
  const {
    files,
    currentFile,
    debugOptions,
    getFileTags,
    getFileDate: getFileDateFn,
    tagDefinitions,
    actionBar,
  } = useProject()
  const [searchParams] = useSearchParams()
  const spotlight = useMemo(() => parseSpotlight(searchParams.get("spotlight")), [searchParams])
  const editorSelection = useEditorSelection()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  useScrollToEntity(editorContainerRef, currentFile)

  const rawContent = currentFile ? getFileRaw(files, currentFile) : undefined
  const content = useMemo(() => {
    if (!rawContent || !currentFile) return rawContent
    return rawContent
  }, [rawContent, currentFile])
  const copyRawMarkdown = useCallback(() => {
    if (rawContent) navigator.clipboard.writeText(rawContent)
  }, [rawContent])
  const tagDefMap = useMemo(() => new Map(tagDefinitions.map((d) => [d.id, d])), [tagDefinitions])
  const tags = useMemo(() => {
    if (!currentFile) return []
    const resolved = getFileTags(currentFile)
      .map((tagId) => tagDefMap.get(tagId))
      .filter((d): d is NonNullable<typeof d> => d !== undefined)
    return sortTagsByDisplay(resolved)
  }, [currentFile, getFileTags, tagDefMap])
  const fileDate = useMemo(
    () => (currentFile ? getFileDateFn(currentFile) : undefined),
    [currentFile, getFileDateFn]
  )

  const handleRemoveTag = useCallback(
    (tagId: string) => {
      if (!currentFile) return
      const allTagIds = getFileTags(currentFile)
      patchBlock(currentFile, ATTRIBUTES_LANGUAGE, removeTagOp(allTagIds, tagId))
    },
    [currentFile, getFileTags]
  )

  const handleScrollTo = useCallback((percent: number) => {
    const container = scrollContainerRef.current
    if (!container) return
    const maxScroll = container.scrollHeight - container.clientHeight
    const targetScroll = (percent / 100) * maxScroll
    container.scrollTo({ top: targetScroll, behavior: "smooth" })
  }, [])

  if (!currentFile || content === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-subtext-color">Select a file</div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col gap-2 bg-neutral-100 p-2">
      <div className="flex flex-1 min-h-0 flex-col rounded-xl border border-solid border-panel-border bg-default-background overflow-hidden">
        <FileHeader
          title={toDisplayName(currentFile)}
          date={fileDate}
          tags={tags}
          onRemoveTag={handleRemoveTag}
          menuItems={[
            { icon: <Clipboard />, label: "Copy raw", onClick: copyRawMarkdown },
            { icon: <Share2 />, label: "Share", onClick: () => undefined },
            { icon: <Copy />, label: "Duplicate", onClick: () => undefined },
            { icon: <FileText />, label: "Export", onClick: () => undefined },
            { icon: <Trash />, label: "Delete", onClick: () => undefined },
          ]}
          onAddTag={() => undefined}
        />
        <div className="flex w-full grow shrink basis-0 min-h-0 items-stretch overflow-hidden">
          <div
            ref={scrollContainerRef}
            className="flex grow shrink-0 basis-0 flex-col items-start pl-12 pr-6 py-6 overflow-auto"
          >
            <div
              ref={editorContainerRef}
              className="relative flex w-full grow flex-col items-start gap-8 pt-8"
            >
              <MilkdownEditor
                key={`${currentFile}-${debugOptions.renderAsJson}`}
                content={formatContent(content, currentFile)}
                debugMode={debugOptions.renderAsJson}
                debugOptions={debugOptions}
                spotlight={spotlight}
                filePath={currentFile}
              />
            </div>
          </div>
          <ScrollGutter
            contentRef={editorContainerRef}
            scrollContainerRef={scrollContainerRef}
            onScrollTo={handleScrollTo}
          />
        </div>
      </div>
      <div className="rounded-xl border border-solid border-panel-border bg-default-background">
        <StatusBar
          text={
            rawContent
              ? `${documentStatusText(rawContent)}${formatSelectionSuffix(editorSelection?.text)}`
              : null
          }
          tooltip={rawContent ? documentStatusTooltip(rawContent) : undefined}
        />
      </div>
      <AnimatePresence>{actionBar}</AnimatePresence>
    </div>
  )
}
