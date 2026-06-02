import {
  useRef,
  useCallback,
  useState,
  useLayoutEffect,
  type ChangeEvent,
  type ReactNode,
} from "react"
import { X, Trash2, MessageSquareWarning, Eraser, Copy, Lock, LockOpen } from "lucide-react"
import { SwapButton } from "~/ui/components/SwapButton"
import { TooltipWrap } from "~/ui/components/TooltipWrap"

export interface HighlightEntry {
  id: string
  color: string
  title?: string
  description?: string
  review?: string
  reviewCount?: number
  isLocked?: boolean
  onLock?: () => void
  onCopy?: () => void
  onDelete?: () => void
  onResolve?: () => void
  onDescriptionChange?: (value: string) => void
  onReviewChange?: (value: string) => void
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

const TEXTAREA_BASE =
  "w-full resize-none border-0 border-b border-solid border-transparent bg-transparent p-0 outline-none transition-colors"
const TEXTAREA_REASON = `${TEXTAREA_BASE} text-caption font-caption text-subtext-color placeholder:text-neutral-400 hover:border-neutral-300 hover:bg-neutral-100 focus:border-neutral-400 focus:bg-neutral-100`
const TEXTAREA_REVIEW = `${TEXTAREA_BASE} text-caption font-caption text-amber-900 placeholder:text-neutral-400 hover:border-amber-300 hover:bg-amber-50/50 focus:border-amber-400 focus:bg-amber-50/50`

const AutoTextarea = ({
  value,
  placeholder,
  className,
  disabled,
  onChange,
}: {
  value: string
  placeholder: string
  className: string
  disabled?: boolean
  onChange: (value: string) => void
}) => {
  const ref = useRef<HTMLTextAreaElement>(null)

  const syncHeight = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0"
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect(syncHeight, [value, syncHeight])

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value)
    },
    [onChange]
  )

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      onChange={handleChange}
      onFocus={syncHeight}
    />
  )
}

const ReasonField = ({ entry }: { entry: HighlightEntry }) => {
  const [local, setLocal] = useState(entry.description ?? "")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locked = !!entry.isLocked

  const handleChange = useCallback(
    (value: string) => {
      setLocal(value)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (!entry.onDescriptionChange) return
      const cb = entry.onDescriptionChange
      timerRef.current = setTimeout(() => cb(value), 500)
    },
    [entry.onDescriptionChange]
  )

  if (!entry.onDescriptionChange) {
    return entry.description ? (
      <span className="text-caption font-caption text-subtext-color">{entry.description}</span>
    ) : null
  }

  return (
    <TooltipWrap text="Unlock to edit" open={locked ? undefined : false}>
      <div className={`w-full ${locked ? "opacity-60 cursor-not-allowed" : ""}`}>
        <AutoTextarea
          value={local}
          placeholder="Add reason..."
          className={TEXTAREA_REASON}
          disabled={locked}
          onChange={handleChange}
        />
      </div>
    </TooltipWrap>
  )
}

const ReviewField = ({ entry }: { entry: HighlightEntry }) => {
  const [local, setLocal] = useState(entry.review ?? "")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locked = !!entry.isLocked
  const hasText = local.length > 0

  const handleChange = useCallback(
    (value: string) => {
      setLocal(value)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (!entry.onReviewChange) return
      const cb = entry.onReviewChange
      timerRef.current = setTimeout(() => cb(value), 500)
    },
    [entry.onReviewChange]
  )

  if (!entry.onReviewChange) {
    return entry.review ? (
      <div className="mt-2 flex w-full items-center gap-2">
        <div className="w-3 flex-none" />
        <div className="flex grow min-w-0 items-start rounded bg-amber-100/40 px-2 py-1.5">
          <span className="text-caption font-caption text-amber-900">{entry.review}</span>
        </div>
      </div>
    ) : null
  }

  return (
    <div className="mt-2 flex w-full items-center gap-2">
      <div className="w-3 flex-none" />
      <TooltipWrap text="Unlock to edit" open={locked ? undefined : false}>
        <div
          className={`flex grow min-w-0 items-start rounded bg-amber-100/40 px-2 py-1.5 ${locked ? "opacity-60 cursor-not-allowed" : ""}`}
        >
          <AutoTextarea
            value={local}
            placeholder="Add review note..."
            className={TEXTAREA_REVIEW}
            disabled={locked}
            onChange={handleChange}
          />
        </div>
      </TooltipWrap>
      <div className="flex flex-none flex-col items-center gap-1">
        {entry.onResolve &&
          (locked ? (
            <DisabledButton
              icon={<MessageSquareWarning className="text-body text-amber-600" />}
              tooltip="Unlock to edit"
            />
          ) : hasText ? (
            <SwapButton
              idle={<MessageSquareWarning className="text-body text-amber-600" />}
              active={<Eraser className="text-body text-green-600" />}
              activeTooltip="Clear review"
              onClick={entry.onResolve}
            />
          ) : (
            <MessageSquareWarning className="text-body text-neutral-300" />
          ))}
        {entry.reviewCount != null && entry.reviewCount > 0 && (
          <button
            className="flex h-4 min-w-4 cursor-pointer items-center justify-center rounded-full border border-solid border-amber-600 bg-transparent px-1 text-[10px] font-bold leading-none text-amber-600 hover:bg-amber-600 hover:text-white"
            title={`${entry.reviewCount} flagged annotations for this code`}
            onClick={entry.onReviewCountClick}
          >
            {entry.reviewCount}
          </button>
        )}
      </div>
    </div>
  )
}

const DisabledButton = ({ icon, tooltip }: { icon: ReactNode; tooltip: string }) => (
  <TooltipWrap text={tooltip}>
    <div className="flex h-6 min-w-6 items-center justify-center opacity-40 cursor-not-allowed">
      {icon}
    </div>
  </TooltipWrap>
)

const EntryContent = ({ entry }: { entry: HighlightEntry }) => (
  <div className="flex w-full flex-col">
    <div className="flex w-full items-center gap-2">
      <div
        className="flex h-3 w-3 flex-none rounded-full"
        style={{ backgroundColor: entry.color }}
      />
      <div className="flex min-w-0 grow items-center">
        {entry.title &&
          (entry.onTitleClick ? (
            <button
              className="text-body-bold font-body-bold text-default-font cursor-pointer truncate border-none bg-transparent p-0 text-left hover:underline"
              onClick={entry.onTitleClick}
            >
              {entry.title}
            </button>
          ) : (
            <span className="text-body-bold font-body-bold text-default-font truncate">
              {entry.title}
            </span>
          ))}
      </div>
      {entry.onLock && (
        <SwapButton
          idle={
            entry.isLocked ? (
              <Lock className="text-body text-blue-600" />
            ) : (
              <Lock className="text-body text-neutral-400" />
            )
          }
          active={
            entry.isLocked ? (
              <LockOpen className="text-body text-neutral-700" />
            ) : (
              <Lock className="text-body text-blue-600" />
            )
          }
          activeTooltip={entry.isLocked ? "Unlock annotation" : "Lock annotation"}
          onClick={entry.onLock}
        />
      )}
      {entry.onCopy && (
        <SwapButton
          idle={<Copy className="text-body text-neutral-700" />}
          active={<Copy className="text-body text-neutral-900" />}
          activeTooltip="Copy annotation"
          onClick={entry.onCopy}
        />
      )}
      {entry.onDelete &&
        (entry.isLocked ? (
          <DisabledButton
            icon={<X className="text-body text-neutral-700" />}
            tooltip="Unlock to edit"
          />
        ) : (
          <SwapButton
            idle={<X className="text-body text-neutral-700" />}
            active={<Trash2 className="text-body text-error-600" />}
            activeTooltip="Remove annotation"
            onClick={entry.onDelete}
          />
        ))}
    </div>
    <div className="flex w-full items-start gap-2 mt-1">
      <div className="w-3 flex-none" />
      <ReasonField entry={entry} />
    </div>
    <ReviewField entry={entry} />
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
