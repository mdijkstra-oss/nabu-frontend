import { useCallback, useMemo } from "react"
import { AnimatePresence } from "framer-motion"
import { useSearchParams, useNavigate, useParams } from "react-router"
import { parseSpotlight } from "~/lib/editor/spotlight/parse"
import { patchBlock } from "~/lib/data-blocks/patch"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { getTagDisplay } from "~/domain/data-blocks/settings/tags/selectors"
import { selectedFiles } from "~/domain/data-blocks/ux/selectors"
import { buildSelectionEntry } from "~/domain/search/selection-search"
import { saveNewSearch } from "~/lib/agent/tools/search/settings"
import { useProject } from "./project"
import { DocumentBubble } from "~/ui/components/editor/DocumentBubble"
import { DocumentStack } from "~/ui/components/editor/DocumentStack"
import { Clipboard, Copy, FileText, Share2, Trash } from "lucide-react"

const ATTRIBUTES_LANGUAGE = "json-attributes"

const sortTagsByDisplay = (tags: TagDefinition[]): TagDefinition[] =>
  [...tags].sort((a, b) => getTagDisplay(a).localeCompare(getTagDisplay(b)))

const removeTagOp = (allTagIds: string[], tagId: string) => [
  { op: "replace" as const, path: "/tags", value: allTagIds.filter((id) => id !== tagId) },
]

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
  const params = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const spotlight = useMemo(() => parseSpotlight(searchParams.get("spotlight")), [searchParams])

  const content = currentFile ? files[currentFile] : undefined
  const copyRawMarkdown = useCallback(() => {
    if (content) navigator.clipboard.writeText(content)
  }, [content])

  const openStack = useCallback(() => {
    const ids = selectedFiles(files, currentFile)
    if (ids.length <= 1) return
    const id = saveNewSearch(buildSelectionEntry(ids))
    navigate(`/project/${params.projectId}/search/${id}`)
  }, [files, currentFile, params.projectId, navigate])

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

  if (!currentFile || content === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-subtext-color">Select a file</div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 bg-neutral-100 p-4">
      <DocumentStack
        files={files}
        activeId={currentFile}
        onUnderlyingClick={openStack}
        className="flex flex-1 min-h-0"
        front={
          <DocumentBubble
            filename={currentFile}
            content={content}
            tags={tags}
            date={fileDate}
            debugMode={debugOptions.renderAsJson}
            debugOptions={debugOptions}
            spotlight={spotlight}
            menuItems={[
              { icon: <Clipboard />, label: "Copy raw", onClick: copyRawMarkdown },
              { icon: <Share2 />, label: "Share", onClick: () => undefined },
              { icon: <Copy />, label: "Duplicate", onClick: () => undefined },
              { icon: <FileText />, label: "Export", onClick: () => undefined },
              { icon: <Trash />, label: "Delete", onClick: () => undefined },
            ]}
            onAddTag={() => undefined}
            onRemoveTag={handleRemoveTag}
          />
        }
      />
      <AnimatePresence mode="wait">{actionBar}</AnimatePresence>
    </div>
  )
}
