import { useMemo } from "react"
import { FileText, Search } from "lucide-react"
import { IconButton } from "~/ui/components/IconButton"
import { TooltipWrap } from "~/ui/components/TooltipWrap"
import { TagBadge } from "~/ui/components/TagBadge"
import { MilkdownEditor } from "~/ui/components/editor/MilkdownEditor"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { refreshHits } from "~/lib/search/slices"
import { useThrottledValue } from "~/ui/hooks/useThrottledValue"
import { toDisplayName } from "~/lib/files/filename"
import { getTags } from "~/domain/data-blocks/attributes/tags/selectors"
import { findTagDefinitionById } from "~/domain/data-blocks/settings/tags/selectors"
import { spotlightFromText, serializeSpotlight } from "~/lib/editor/spotlight/serialize"

export interface SearchResultListProps {
  hits: SearchHit[]
  files: FileStore
  projectId: string
  activeTags?: Set<string>
  onNavigate?: (url: string) => void
}

interface RunGroup {
  file: string
  hits: SearchHit[]
}

const groupByRun = (hits: SearchHit[]): RunGroup[] => {
  const groups: RunGroup[] = []
  for (const hit of hits) {
    const last = groups[groups.length - 1]
    if (last && last.file === hit.file) last.hits.push(hit)
    else groups.push({ file: hit.file, hits: [hit] })
  }
  return groups
}

const hitHasId = (hit: SearchHit): hit is SearchHit & { id: string } => hit.id !== undefined
const hitHasText = (hit: SearchHit): hit is SearchHit & { text: string } => hit.text !== undefined
const hitIsFileOnly = (hit: SearchHit): boolean => !hitHasId(hit) && !hitHasText(hit)

const hitKey = (hit: SearchHit, index: number): string =>
  hit.id ?? (hit.text ? `text-${index}` : `file-${index}`)

const buildFileUrl = (projectId: string, file: string): string =>
  `/project/${projectId}/file/${encodeURIComponent(file)}`

const buildHitUrl = (projectId: string, hit: SearchHit): string => {
  const base = buildFileUrl(projectId, hit.file)
  if (hit.id) return `${base}?entity=${encodeURIComponent(hit.id)}`
  if (hit.text) {
    const spotlight = spotlightFromText(hit.text)
    if (spotlight) return `${base}?spotlight=${encodeURIComponent(serializeSpotlight(spotlight))}`
  }
  return base
}

const GUTTER = "w-10 shrink-0 flex items-center justify-center"

const SearchSlicePreview = ({
  text,
  filePath,
  onNavigate,
}: {
  text: string
  filePath: string
  onNavigate?: () => void
}) => (
  <div className="group/hit flex w-full items-center">
    <div className={GUTTER} />
    <div className="min-w-0 grow rounded-md border border-solid border-neutral-200 px-4 py-3">
      <MilkdownEditor content={text} readOnly filePath={filePath} />
    </div>
    <div className={GUTTER}>
      {onNavigate && (
        <TooltipWrap text="Show in file">
          <IconButton
            size="small"
            variant="brand-tertiary"
            icon={<Search />}
            onClick={onNavigate}
            className="bg-white border border-solid border-neutral-border hover:border-brand-200 opacity-0 transition-opacity group-hover/hit:opacity-100"
          />
        </TooltipWrap>
      )}
    </div>
  </div>
)

const RunGroupCard = ({
  group,
  files,
  projectId,
  activeTags,
  onNavigate,
}: {
  group: RunGroup
  files: FileStore
  projectId: string
  activeTags?: Set<string>
  onNavigate?: (url: string) => void
}) => {
  const fileUrl = buildFileUrl(projectId, group.file)
  const content = files[group.file] ?? ""
  const tagIds = getTags(content)
  const tags = tagIds
    .map((id) => findTagDefinitionById(files, id))
    .filter((t): t is NonNullable<typeof t> => t !== null)

  const isFileOnlyGroup = group.hits.every(hitIsFileOnly)
  const detailHits = group.hits.filter((h) => !hitIsFileOnly(h))

  const handleOpenFile = () => onNavigate?.(fileUrl)

  const hitsToRender = isFileOnlyGroup ? [{ file: group.file }] : detailHits

  return (
    <div className="flex w-full flex-col items-start overflow-hidden rounded-lg border border-solid border-neutral-border bg-default-background shadow-sm">
      <div className="flex w-full items-center gap-4 border-b border-solid border-neutral-border bg-neutral-50 px-4 py-3">
        <FileText className="text-body font-body text-brand-600" />
        <button
          type="button"
          className="grow shrink-0 basis-0 text-left text-body-bold font-body-bold text-default-font hover:text-brand-600 transition-colors cursor-pointer"
          onClick={handleOpenFile}
        >
          {toDisplayName(group.file)}
        </button>
        {tags.map((tag) => (
          <TagBadge key={tag.id} tag={tag} active={!activeTags || activeTags.has(tag.id)} />
        ))}
      </div>
      <div className="flex w-full flex-col items-start gap-4 py-5">
        {hitsToRender.map((hit, i) =>
          hit.text ? (
            <SearchSlicePreview
              key={hitKey(hit, i)}
              text={hit.text}
              filePath={hit.file}
              onNavigate={() => onNavigate?.(buildHitUrl(projectId, hit))}
            />
          ) : null
        )}
      </div>
    </div>
  )
}

export const SearchResultList = ({
  hits,
  files,
  projectId,
  activeTags,
  onNavigate,
}: SearchResultListProps) => {
  const throttledFiles = useThrottledValue(files, 500)
  const liveHits = useMemo(() => refreshHits(hits, throttledFiles), [hits, throttledFiles])
  const groups = useMemo(() => groupByRun(liveHits), [liveHits])

  return (
    <div className="flex w-full flex-col items-start gap-6">
      {groups.map((group, i) => (
        <RunGroupCard
          key={`${group.file}-${i}`}
          group={group}
          files={files}
          projectId={projectId}
          activeTags={activeTags}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}
