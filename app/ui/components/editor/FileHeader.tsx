"use client"

import type { ReactNode } from "react"
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

export const FileHeader = ({
  title,
  date,
  tags = [],
  onRemoveTag,
  onAddTag,
  menuItems = [],
  onTitleClick,
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
    {onTitleClick ? (
      <button
        type="button"
        onClick={onTitleClick}
        className="min-w-0 grow truncate text-left text-body-bold font-body-bold text-default-font transition-colors hover:text-brand-600"
      >
        {title}
      </button>
    ) : (
      <span className="min-w-0 grow truncate text-body-bold font-body-bold text-default-font">
        {title}
      </span>
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
