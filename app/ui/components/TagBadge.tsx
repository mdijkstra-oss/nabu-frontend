import type { ComponentType } from "react"
import { X } from "lucide-react"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { getTagDisplay } from "~/domain/data-blocks/settings/tags/selectors"
import { resolveIcon } from "~/ui/theme/icon-map"
import {
  elementBackground,
  hoveredElementBackground,
  solidBackground,
  lowContrastText,
} from "~/ui/theme/radix"
import { cn } from "~/ui/utils"

interface TagBadgeProps {
  tag: TagDefinition
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  onRemove?: () => void
  className?: string
}

const TagIcon = ({
  icon: Icon,
  color,
}: {
  icon: ComponentType<{ className?: string }>
  color: string
}) => (
  <span className="inline-flex" style={{ color }}>
    <Icon className="h-3 w-3" />
  </span>
)

const hasHandler = (fn: (() => void) | undefined): fn is () => void => fn !== undefined

export const TagBadge = ({
  tag,
  active = true,
  disabled = false,
  onClick,
  onRemove,
  className,
}: TagBadgeProps) => {
  const Icon = resolveIcon(tag.icon)
  const colored = active

  const style = colored
    ? ({
        "--tag-bg": elementBackground(tag.color),
        "--tag-hover-bg": hoveredElementBackground(tag.color),
        "--tag-fg": lowContrastText(tag.color),
        "--tag-icon": solidBackground(tag.color),
        backgroundColor: "var(--tag-bg)",
        color: "var(--tag-fg)",
      } as React.CSSProperties)
    : undefined

  const iconColor = colored ? "var(--tag-icon)" : "currentColor"

  const Tag = hasHandler(onClick) ? "button" : "span"

  return (
    <Tag
      type={hasHandler(onClick) ? "button" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption-bold font-caption-bold transition-colors",
        colored && "hover:!bg-[var(--tag-hover-bg)]",
        hasHandler(onClick) && !disabled && "cursor-pointer border-none",
        disabled && "cursor-not-allowed border-none",
        !colored && "bg-neutral-100 text-subtext-color hover:bg-neutral-200",
        className
      )}
      style={style}
      onClick={onClick}
    >
      <TagIcon icon={Icon} color={iconColor} />
      {getTagDisplay(tag)}
      {hasHandler(onRemove) && (
        <button
          type="button"
          className="inline-flex cursor-pointer items-center border-none bg-transparent p-0"
          style={{ color: "var(--tag-fg)" }}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Tag>
  )
}
