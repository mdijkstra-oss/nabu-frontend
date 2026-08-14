import { memo, Fragment, useCallback, useMemo } from "react"
import { LocateFixed } from "lucide-react"
import { IconButton } from "~/ui/components/IconButton"
import { TooltipWrap } from "~/ui/components/TooltipWrap"
import { MilkdownEditor } from "~/ui/components/editor/MilkdownEditor"
import { FileHeader } from "~/ui/components/editor/FileHeader"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { toDisplayName } from "~/lib/files/filename"
import { getTags } from "~/domain/data-blocks/attributes/tags/selectors"
import { getFileDate } from "~/domain/data-blocks/attributes/date/selectors"
import { getRenderableRegionMarks, type RenderableRegions } from "~/domain/regions/selectors"
import { findTagDefinitionById } from "~/domain/data-blocks/settings/tags/selectors"
import {
  spotlightFromText,
  spotlightFromMatches,
  serializeSpotlightParam,
} from "~/lib/editor/spotlight/serialize"
import type { Spotlight } from "~/lib/editor/spotlight/types"
import { splitSentences } from "~/lib/text/split"

export interface RunGroup {
  file: string
  hits: SearchHit[]
}

export interface MatchRangeMeta {
  confidence?: "clear" | "borderline"
  reasonToKeep?: string
}

export interface SliceDebug {
  score?: number
  constituentScores?: number[]
  splitIndex?: number
  splitTotal?: number
  matchRanges?: MatchRangeMeta[]
  showRawText?: boolean
}

export const groupByRun = (hits: SearchHit[]): RunGroup[] => {
  const groups: RunGroup[] = []
  for (const hit of hits) {
    const last = groups[groups.length - 1]
    if (last && last.file === hit.file) last.hits.push(hit)
    else groups.push({ file: hit.file, hits: [hit] })
  }
  return groups
}

export const groupKey = (group: RunGroup): string => {
  const head = group.hits[0]
  if (!head) return group.file
  if (head.id) return `${group.file}\0${head.id}`
  if (head.text) return `${group.file}\0${head.text.slice(0, 64)}`
  return group.file
}

export const buildFileUrl = (projectId: string, file: string): string =>
  `/project/${projectId}/file/${encodeURIComponent(file)}`

export const SearchSlicePreview = ({
  text,
  filePath,
  spotlights,
  regions,
  debug,
  onNavigate,
}: {
  text: string
  filePath: string
  spotlights: Spotlight[] | null
  regions?: RenderableRegions
  debug?: SliceDebug
  onNavigate?: () => void
}) => (
  <div className="group/hit relative w-full pr-9">
    <div className="flex min-w-0 flex-col gap-2">
      <MilkdownEditor
        content={text}
        readOnly
        filePath={filePath}
        spotlight={spotlights}
        regions={regions}
      />
      {debug && debug.score !== undefined && (
        <div className="px-1 text-[12px] font-mono font-bold text-neutral-700">
          score: {debug.score.toFixed(4)}
          {debug.splitTotal !== undefined &&
            debug.splitTotal > 1 &&
            debug.splitIndex !== undefined && (
              <span className="ml-2 text-neutral-500">
                {splitLabel(debug.splitIndex, debug.splitTotal)}
              </span>
            )}
          {debug.constituentScores && debug.constituentScores.length > 1 && (
            <span className="ml-2 text-neutral-500">
              [{debug.constituentScores.map((s) => s.toFixed(4)).join(", ")}]
            </span>
          )}
          {debug.matchRanges?.map((mr, i) =>
            mr.confidence || mr.reasonToKeep ? (
              <div key={i} className="mt-1 font-normal text-neutral-500">
                {mr.confidence && (
                  <span
                    className={
                      mr.confidence === "borderline" ? "text-amber-700" : "text-emerald-700"
                    }
                  >
                    {mr.confidence}
                  </span>
                )}
                {mr.reasonToKeep && <span className="ml-2">{mr.reasonToKeep}</span>}
              </div>
            ) : null
          )}
        </div>
      )}
      {debug?.showRawText && (
        <pre className="overflow-x-auto rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-[12px] leading-snug font-mono text-neutral-700 whitespace-pre-wrap">
          {text}
        </pre>
      )}
    </div>
    {onNavigate && (
      <div className="absolute top-0 right-0 bottom-0 my-auto flex h-7 items-center">
        <TooltipWrap text="Show in file">
          <IconButton
            size="small"
            variant="neutral-secondary"
            icon={<LocateFixed />}
            onClick={onNavigate}
            className="text-brand-600 opacity-0 transition-opacity hover:!border-brand-200 hover:!bg-brand-50 group-hover/hit:opacity-100"
          />
        </TooltipWrap>
      </div>
    )}
  </div>
)

export interface RunGroupCardProps {
  title: string
  date?: string
  tags: TagDefinition[]
  hits: SearchHit[]
  hitCount: number
  regions?: RenderableRegions
  debug?: SliceDebug
  onOpenFile: () => void
  onNavigateHit: (hit: SearchHit) => void
}

export const RunGroupCard = memo(
  ({
    title,
    date,
    tags,
    hits,
    hitCount,
    regions,
    debug,
    onOpenFile,
    onNavigateHit,
  }: RunGroupCardProps) => (
    <div className="flex w-full flex-col items-start rounded-[14px] border border-solid border-neutral-border bg-default-background">
      <FileHeader
        className="px-6 py-4"
        title={title}
        date={date}
        tags={tags}
        onTitleClick={onOpenFile}
        trailing={
          hitCount > 0 ? (
            <span className="text-caption font-caption text-subtext-color">
              {hitCount} {hitCount === 1 ? "hit" : "hits"}
            </span>
          ) : undefined
        }
      />
      <div className="flex w-full flex-col items-start px-6 py-4">
        {hits.map((hit, i) =>
          hit.text ? (
            <Fragment key={hitKey(hit, i)}>
              {i > 0 && (
                <hr className="my-4 w-full border-0 border-t border-solid border-neutral-200" />
              )}
              <SearchSlicePreview
                text={hit.text}
                filePath={hit.file}
                spotlights={hit.matches ? matchesToSpotlights(hit.matches) : null}
                regions={regions}
                debug={debug && sliceDebugFor(debug, hit)}
                onNavigate={() => onNavigateHit(hit)}
              />
            </Fragment>
          ) : null
        )}
      </div>
    </div>
  )
)

RunGroupCard.displayName = "RunGroupCard"

export interface ConnectedRunGroupCardProps {
  group: RunGroup
  files: FileStore
  projectId: string
  debug?: SliceDebug
  onNavigate?: (url: string) => void
}

export const ConnectedRunGroupCard = ({
  group,
  files,
  projectId,
  debug,
  onNavigate,
}: ConnectedRunGroupCardProps) => {
  const content = files[group.file] ?? ""
  const tags = useMemo(() => resolveFileTags(files, content), [files, content])
  const regions = useMemo(() => getRenderableRegionMarks(content), [content])
  const detailHits = useMemo(() => group.hits.filter((h) => !hitIsFileOnly(h)), [group.hits])
  const onOpenFile = useCallback(
    () => onNavigate?.(buildFileUrl(projectId, group.file)),
    [onNavigate, projectId, group.file]
  )
  const onNavigateHit = useCallback(
    (hit: SearchHit) => onNavigate?.(buildHitUrl(projectId, hit)),
    [onNavigate, projectId]
  )

  return (
    <RunGroupCard
      title={toDisplayName(group.file)}
      date={getFileDate(content)}
      tags={tags}
      hits={detailHits}
      hitCount={detailHits.length}
      regions={regions}
      debug={debug}
      onOpenFile={onOpenFile}
      onNavigateHit={onNavigateHit}
    />
  )
}

const hitHasId = (hit: SearchHit): hit is SearchHit & { id: string } => hit.id !== undefined
const hitHasText = (hit: SearchHit): hit is SearchHit & { text: string } => hit.text !== undefined
const hitIsFileOnly = (hit: SearchHit): boolean => !hitHasId(hit) && !hitHasText(hit)

const hitKey = (hit: SearchHit, index: number): string => {
  if (hit.text) return `text:${hit.text.slice(0, 80)}`
  if (hit.id) return hit.id
  return `file:${hit.file}:${index}`
}

const buildHitUrl = (projectId: string, hit: SearchHit): string => {
  const base = buildFileUrl(projectId, hit.file)
  if (hit.id) return `${base}?entity=${encodeURIComponent(hit.id)}`
  const spotlight = hit.matches
    ? spotlightFromMatches(hit.matches)
    : hit.text
      ? spotlightFromText(hit.text)
      : null
  if (spotlight) return `${base}?spotlight=${serializeSpotlightParam(spotlight)}`
  return base
}

const normalizeMatchWhitespace = (match: string): string => match.replace(/\n\n+/g, " ")

const matchToSpotlights = (text: string): Spotlight[] => {
  const normalized = normalizeMatchWhitespace(text)
  const sentences = splitSentences(normalized)
  if (sentences.length <= 1) return [{ type: "single" as const, text: normalized }]
  return sentences.map((s) => ({ type: "single" as const, text: s }))
}

const matchesToSpotlights = (matches: string[]): Spotlight[] => matches.flatMap(matchToSpotlights)

const splitLabel = (index: number, total: number): string => `part ${index + 1}/${total}`

const sliceDebugFor = (debug: SliceDebug, hit: SearchHit): SliceDebug => ({
  ...debug,
  score: hit.score ?? debug.score,
  constituentScores: hit.constituentScores ?? debug.constituentScores,
  splitIndex: hit.splitIndex ?? debug.splitIndex,
  splitTotal: hit.splitTotal ?? debug.splitTotal,
  matchRanges: hit.matchRanges ?? debug.matchRanges,
})

const resolveFileTags = (files: FileStore, content: string): TagDefinition[] =>
  getTags(content)
    .map((id) => findTagDefinitionById(files, id))
    .filter((t): t is TagDefinition => t != null)
