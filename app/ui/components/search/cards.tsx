import { memo, Fragment } from "react"
import { LocateFixed } from "lucide-react"
import { IconButton } from "~/ui/components/IconButton"
import { TooltipWrap } from "~/ui/components/TooltipWrap"
import { MilkdownEditor } from "~/ui/components/editor/MilkdownEditor"
import { FileHeader } from "~/ui/components/editor/FileHeader"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { toDisplayName } from "~/lib/files/filename"
import { getTags } from "~/domain/data-blocks/attributes/tags/selectors"
import { getFileDate } from "~/domain/data-blocks/attributes/date/selectors"
import { findTagDefinitionById } from "~/domain/data-blocks/settings/tags/selectors"
import {
  spotlightFromText,
  spotlightFromMatches,
  serializeSpotlightParam,
} from "~/lib/editor/spotlight/serialize"
import type { Spotlight } from "~/lib/editor/spotlight/types"
import { splitSentences } from "~/lib/text/split"
import { useDebugOptions } from "~/ui/components/editor/DebugOptionsContext"

const normalizeMatchWhitespace = (match: string): string => match.replace(/\n\n+/g, " ")

export interface RunGroup {
  file: string
  hits: SearchHit[]
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

const hitHasId = (hit: SearchHit): hit is SearchHit & { id: string } => hit.id !== undefined
const hitHasText = (hit: SearchHit): hit is SearchHit & { text: string } => hit.text !== undefined
const hitIsFileOnly = (hit: SearchHit): boolean => !hitHasId(hit) && !hitHasText(hit)

const hitKey = (hit: SearchHit, index: number): string => {
  if (hit.text) return `text:${hit.text.slice(0, 80)}`
  if (hit.id) return hit.id
  return `file:${hit.file}:${index}`
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

const matchToSpotlights = (text: string): Spotlight[] => {
  const normalized = normalizeMatchWhitespace(text)
  const sentences = splitSentences(normalized)
  if (sentences.length <= 1) return [{ type: "single" as const, text: normalized }]
  return sentences.map((s) => ({ type: "single" as const, text: s }))
}

const matchesToSpotlights = (matches: string[]): Spotlight[] => matches.flatMap(matchToSpotlights)

const splitLabel = (index: number, total: number): string => `part ${index + 1}/${total}`

interface MatchRangeMeta {
  confidence?: "clear" | "borderline"
  reasonToKeep?: string
}

const SearchSlicePreview = ({
  text,
  filePath,
  matches,
  matchRanges,
  score,
  constituentScores,
  splitIndex,
  splitTotal,
  onNavigate,
}: {
  text: string
  filePath: string
  matches?: string[]
  matchRanges?: MatchRangeMeta[]
  score?: number
  constituentScores?: number[]
  splitIndex?: number
  splitTotal?: number
  onNavigate?: () => void
}) => {
  const debugOptions = useDebugOptions()
  return (
    <div className="group/hit relative w-full pr-9">
      <div className="flex min-w-0 flex-col gap-2">
        <MilkdownEditor
          content={text}
          readOnly
          filePath={filePath}
          spotlight={matches ? matchesToSpotlights(matches) : null}
        />
        {debugOptions.showHitScore && score !== undefined && (
          <div className="px-1 text-[12px] font-mono font-bold text-neutral-700">
            score: {score.toFixed(4)}
            {splitTotal !== undefined && splitTotal > 1 && splitIndex !== undefined && (
              <span className="ml-2 text-neutral-500">{splitLabel(splitIndex, splitTotal)}</span>
            )}
            {constituentScores && constituentScores.length > 1 && (
              <span className="ml-2 text-neutral-500">
                [{constituentScores.map((s) => s.toFixed(4)).join(", ")}]
              </span>
            )}
            {matchRanges?.map((mr, i) =>
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
        {debugOptions.renderAsJson && (
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
}

export interface RunGroupCardProps {
  group: RunGroup
  files: FileStore
  projectId: string
  onNavigate?: (url: string) => void
}

const areGroupPropsEqual = (prev: RunGroupCardProps, next: RunGroupCardProps): boolean =>
  prev.group.file === next.group.file &&
  prev.group.hits === next.group.hits &&
  prev.files === next.files &&
  prev.projectId === next.projectId &&
  prev.onNavigate === next.onNavigate

export const RunGroupCard = memo(({ group, files, projectId, onNavigate }: RunGroupCardProps) => {
  const fileUrl = buildFileUrl(projectId, group.file)
  const content = files[group.file] ?? ""
  const tagIds = getTags(content)
  const tags = tagIds
    .map((id) => findTagDefinitionById(files, id))
    .filter((t): t is NonNullable<typeof t> => t != null)
  const date = getFileDate(content)

  const isFileOnlyGroup = group.hits.every(hitIsFileOnly)
  const detailHits = group.hits.filter((h) => !hitIsFileOnly(h))

  const handleOpenFile = () => onNavigate?.(fileUrl)

  const hitsToRender = isFileOnlyGroup ? [{ file: group.file }] : detailHits
  const hitCount = isFileOnlyGroup ? 0 : detailHits.length

  return (
    <div className="flex w-full flex-col items-start rounded-[14px] border border-solid border-neutral-border bg-default-background">
      <FileHeader
        className="px-6 py-4"
        title={toDisplayName(group.file)}
        date={date}
        tags={tags}
        onTitleClick={handleOpenFile}
        trailing={
          hitCount > 0 ? (
            <span className="text-caption font-caption text-subtext-color">
              {hitCount} {hitCount === 1 ? "hit" : "hits"}
            </span>
          ) : undefined
        }
      />
      <div className="flex w-full flex-col items-start px-6 py-4">
        {hitsToRender.map((hit, i) =>
          hit.text ? (
            <Fragment key={hitKey(hit, i)}>
              {i > 0 && (
                <hr className="my-4 w-full border-0 border-t border-solid border-neutral-200" />
              )}
              <SearchSlicePreview
                text={hit.text}
                filePath={hit.file}
                matches={hit.matches}
                matchRanges={hit.matchRanges}
                score={hit.score}
                constituentScores={hit.constituentScores}
                splitIndex={hit.splitIndex}
                splitTotal={hit.splitTotal}
                onNavigate={() => onNavigate?.(buildHitUrl(projectId, hit))}
              />
            </Fragment>
          ) : null
        )}
      </div>
    </div>
  )
}, areGroupPropsEqual)
