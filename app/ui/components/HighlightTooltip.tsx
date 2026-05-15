import { X, Trash2 } from "lucide-react"
import { SwapButton } from "~/ui/components/SwapButton"

export interface HighlightEntry {
  id: string
  color: string
  title?: string
  description?: string
  review?: string[]
  onDelete?: () => void
}

interface HighlightTooltipProps {
  entries: HighlightEntry[]
  onEntryHover?: (id: string) => void
  onEntryLeave?: () => void
}

const Divider = () => <div className="h-px w-full bg-neutral-border" />

const ReviewBlock = ({ justifications }: { justifications: string[] }) => (
  <div className="mt-1 rounded bg-amber-200/70 px-2 py-1.5 w-full">
    <span className="text-caption font-caption text-amber-900 font-semibold">Review</span>
    <ul className="list-disc pl-4 mt-0.5">
      {justifications.map((j, i) => (
        <li key={i} className="text-caption font-caption text-amber-900">
          {j}
        </li>
      ))}
    </ul>
  </div>
)

const createHeaderBackground = (colors: string[]): string => {
  if (colors.length === 0) return "transparent"
  if (colors.length === 1) return colors[0]
  if (colors.length === 2) return `linear-gradient(to right, ${colors[0]}, ${colors[1]})`
  return `linear-gradient(to right, ${colors[0]}, ${colors.slice(1, -1).join(", ")}, ${colors[colors.length - 1]})`
}

const EntryContent = ({ entry }: { entry: HighlightEntry }) => (
  <div className="flex w-full items-start gap-2">
    <div
      className="flex h-3 w-3 flex-none rounded-full mt-0.5"
      style={{ backgroundColor: entry.color }}
    />
    <div className="flex grow shrink-0 basis-0 flex-col items-start gap-1">
      {entry.title && (
        <span className="text-body-bold font-body-bold text-default-font">{entry.title}</span>
      )}
      {entry.description && (
        <span className="text-caption font-caption text-subtext-color">{entry.description}</span>
      )}
      {entry.review && entry.review.length > 0 && <ReviewBlock justifications={entry.review} />}
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
