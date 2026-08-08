"use client"

import { useState, type ReactNode } from "react"
import { MoreHorizontal, Plus } from "lucide-react"
import * as SubframeCore from "@subframe/core"
import { DropdownMenu } from "~/ui/components/DropdownMenu"
import { IconButton } from "~/ui/components/IconButton"
import { TooltipWrap } from "~/ui/components/TooltipWrap"
import { cn } from "~/ui/utils"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { getTagDisplay } from "~/domain/data-blocks/settings/tags/selectors"
import { solidBackground } from "~/ui/theme/radix"
import { formatShortDate } from "~/lib/format/date"

interface MenuItem {
  icon: ReactNode
  label: string
  onClick: () => void
}

interface FileHeaderProps {
  title: string
  date?: string
  tags?: TagDefinition[]
  onRemoveTag?: (tagId: string) => void
  onAddTag?: () => void
  menuItems?: MenuItem[]
  onTitleClick?: () => void
  onRename?: (title: string) => void
  trailing?: ReactNode
  className?: string
}

const TagDot = ({ tag, onRemove }: { tag: TagDefinition; onRemove?: () => void }) => {
  const dot = "h-2.5 w-2.5 flex-none rounded-full"
  const style = { backgroundColor: solidBackground(tag.color) }
  return (
    <TooltipWrap text={getTagDisplay(tag)}>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${getTagDisplay(tag)}`}
          onClick={onRemove}
          className={cn(dot, "cursor-pointer transition-transform hover:scale-125")}
          style={style}
        />
      ) : (
        <span className={dot} style={style} />
      )}
    </TooltipWrap>
  )
}

const titleStyle = "min-w-0 grow text-body-bold font-body-bold text-default-font"

const EditableTitle = ({
  title,
  onRename,
}: {
  title: string
  onRename: (title: string) => void
}) => {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(title)}
        className={cn(titleStyle, "truncate text-left")}
      >
        {title}
      </button>
    )
  }

  const commit = () => {
    const next = draft.trim()
    setDraft(null)
    if (next !== "" && next !== title) onRename(next)
  }

  return (
    <input
      autoFocus
      aria-label="Document title"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit()
        if (e.key === "Escape") setDraft(null)
      }}
      className={cn(titleStyle, "bg-transparent outline-none")}
    />
  )
}

export const FileHeader = ({
  title,
  date,
  tags = [],
  onRemoveTag,
  onAddTag,
  menuItems = [],
  onTitleClick,
  onRename,
  trailing,
  className,
}: FileHeaderProps) => (
  <div
    className={cn("flex w-full items-center gap-2.5 px-4 py-2.5 shadow-header-divider", className)}
  >
    {tags.length > 0 && (
      <span className="flex flex-none items-center gap-1">
        {tags.map((tag) => (
          <TagDot
            key={tag.id}
            tag={tag}
            onRemove={onRemoveTag ? () => onRemoveTag(tag.id) : undefined}
          />
        ))}
      </span>
    )}
    {onRename ? (
      <EditableTitle title={title} onRename={onRename} />
    ) : onTitleClick ? (
      <button
        type="button"
        onClick={onTitleClick}
        className={cn(titleStyle, "truncate text-left transition-colors hover:text-brand-600")}
      >
        {title}
      </button>
    ) : (
      <span className={cn(titleStyle, "truncate")}>{title}</span>
    )}
    <div className="flex flex-none items-center gap-2.5">
      {trailing}
      {date && (
        <span className="text-caption font-caption text-subtext-color">
          {formatShortDate(date)}
        </span>
      )}
      {onAddTag && <IconButton size="small" icon={<Plus />} onClick={onAddTag} />}
      {menuItems.length > 0 && (
        <SubframeCore.DropdownMenu.Root>
          <SubframeCore.DropdownMenu.Trigger asChild>
            <IconButton size="small" icon={<MoreHorizontal />} />
          </SubframeCore.DropdownMenu.Trigger>
          <SubframeCore.DropdownMenu.Portal>
            <SubframeCore.DropdownMenu.Content side="bottom" align="end" sideOffset={4} asChild>
              <DropdownMenu>
                {menuItems.map((item) => (
                  <DropdownMenu.DropdownItem
                    key={item.label}
                    icon={item.icon}
                    onClick={item.onClick}
                  >
                    {item.label}
                  </DropdownMenu.DropdownItem>
                ))}
              </DropdownMenu>
            </SubframeCore.DropdownMenu.Content>
          </SubframeCore.DropdownMenu.Portal>
        </SubframeCore.DropdownMenu.Root>
      )}
    </div>
  </div>
)
