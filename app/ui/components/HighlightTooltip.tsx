import { X, Trash2, MessageSquareWarning, Eraser } from "lucide-react"
import { SwapButton } from "~/ui/components/SwapButton"

export interface HighlightEntry {
  id: string
  color: string
  title?: string
  description?: string
  review?: string[]
  reviewCount?: number
  onDelete?: () => void
  onResolve?: () => void
  onReviewCountClick?: () => void
  onTitleClick?: () => void
}

interface HighlightTooltipProps {
  entries: HighlightEntry[]
  onEntryHover?: (id: string) => void
  onEntryLeave?: () => void
}

const Divider = () => <div className="h-px w-full bg-neutral-border" />

const createHeaderBackground = (colors: string[]): string => {
  if (colors.length === 0) return "transparent"
  if (colors.length === 1) return colors[0]
  if (colors.length === 2) return `linear-gradient(to right, ${colors[0]}, ${colors[1]})`
  return `linear-gradient(to right, ${colors[0]}, ${colors.slice(1, -1).join(", ")}, ${colors[colors.length - 1]})`
}

const EntryContent = ({ entry }: { entry: HighlightEntry }) => (
  <div className="flex w-full flex-col">
    <div className="flex w-full items-start gap-2">
      <div
        className="flex h-3 w-3 flex-none rounded-full mt-0.5"
        style={{ backgroundColor: entry.color }}
      />
      <div className="flex grow shrink-0 basis-0 flex-col items-start gap-1">
        {entry.title &&
          (entry.onTitleClick ? (
            <button
              className="text-body-bold font-body-bold text-default-font cursor-pointer border-none bg-transparent p-0 text-left hover:underline"
              onClick={entry.onTitleClick}
            >
              {entry.title}
            </button>
          ) : (
            <span className="text-body-bold font-body-bold text-default-font">{entry.title}</span>
          ))}
        {entry.description && (
          <span className="text-caption font-caption text-subtext-color">{entry.description}</span>
        )}
      </div>
      {entry.onDelete && (
        <SwapButton
          idle={<X className="text-body text-neutral-700" />}
          active={<Trash2 className="text-body text-error-600" />}
          activeTooltip="Remove annotation"
          onClick={entry.onDelete}
        />
      )}
    </div>
    {entry.review && entry.review.length > 0 && (
      <div className="mt-1 flex w-full items-start gap-2">
        <div className="w-3 flex-none" />
        <div className="flex grow min-w-0 items-start rounded bg-amber-200/70 px-2 py-1.5">
          <span className="text-caption font-caption text-amber-900">{entry.review.join(" ")}</span>
        </div>
        <div className="flex flex-none flex-col items-center gap-1">
          {entry.onResolve && (
            <SwapButton
              idle={<MessageSquareWarning className="text-body text-amber-600" />}
              active={<Eraser className="text-body text-green-600" />}
              activeTooltip="Clear review"
              onClick={entry.onResolve}
            />
          )}
          {entry.reviewCount != null && entry.reviewCount > 1 && (
            <button
              className="flex h-4 min-w-4 cursor-pointer items-center justify-center rounded-full border border-solid border-amber-600 bg-transparent px-1 text-[10px] font-bold leading-none text-amber-600 hover:bg-amber-600 hover:text-white"
              title={`${entry.reviewCount - 1} other flagged annotations for this code`}
              onClick={entry.onReviewCountClick}
            >
              {entry.reviewCount - 1}
            </button>
          )}
        </div>
      </div>
    )}
  </div>
)

const isMultiEntry = (entries: HighlightEntry[]): boolean => entries.length > 1

export const HighlightTooltip = ({
  entries,
  onEntryHover,
  onEntryLeave,
}: HighlightTooltipProps) => {
  if (entries.length === 0) return null

  const colors = entries.map((e) => e.color)
  const hoverable = isMultiEntry(entries) && !!onEntryHover

  return (
    <div
      data-tooltip-root
      className="flex w-96 flex-none flex-col items-start overflow-hidden rounded-lg border border-solid border-neutral-border bg-default-background shadow-lg"
    >
      <div
        className="flex h-1 w-full flex-none"
        style={{ background: createHeaderBackground(colors) }}
      />
      <div
        className="flex w-full min-h-0 flex-col items-start overflow-y-auto"
        onMouseLeave={hoverable ? onEntryLeave : undefined}
      >
        {entries.map((entry, i) => (
          <div key={entry.id} className="flex w-full flex-col items-start">
            {i > 0 && <Divider />}
            <div
              className={`flex w-full px-3 py-2 ${hoverable ? "hover:bg-neutral-100" : ""}`}
              onMouseEnter={hoverable ? () => onEntryHover(entry.id) : undefined}
            >
              <EntryContent entry={entry} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
