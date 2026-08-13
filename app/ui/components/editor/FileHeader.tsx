"use client"

import { Fragment, useState, type ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"
import * as SubframeCore from "@subframe/core"
import { DropdownMenu } from "~/ui/components/DropdownMenu"
import { IconButton } from "~/ui/components/IconButton"
import { TooltipWrap } from "~/ui/components/TooltipWrap"
import { cn } from "~/ui/utils"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { getTagDisplay } from "~/domain/data-blocks/settings/tags/selectors"
import { solidBackground } from "~/ui/theme/radix"
import { formatShortDate } from "~/lib/format/date"

export interface MenuItem {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  confirm?: boolean
}

interface FileHeaderProps {
  title: string
  date?: string
  tags?: TagDefinition[]
  onRemoveTag?: (tagId: string) => void
  menuGroups?: MenuItem[][]
  onTitleClick?: () => void
  onRename?: (title: string) => void
  renameRequested?: boolean
  onRenameSettled?: () => void
  trailing?: ReactNode
  className?: string
}

export const TagDot = ({ tag, onRemove }: { tag: TagDefinition; onRemove?: () => void }) => {
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

const disabledItemStyle = "cursor-default opacity-40 hover:bg-transparent active:bg-transparent"

const PlainMenuItem = ({ item }: { item: MenuItem }) => (
  <DropdownMenu.DropdownItem
    icon={item.icon}
    disabled={item.disabled}
    onClick={item.disabled ? undefined : item.onClick}
    className={item.disabled ? disabledItemStyle : undefined}
  >
    {item.label}
  </DropdownMenu.DropdownItem>
)

// Arming must not close the menu, so the first select is prevented; the state
// lives here and the closed menu unmounts it, disarming on dismiss.
const ConfirmMenuItem = ({ item }: { item: MenuItem }) => {
  const [armed, setArmed] = useState(false)
  const handleSelect = (event: Event) => {
    if (!armed) {
      event.preventDefault()
      setArmed(true)
      return
    }
    item.onClick()
  }
  return (
    <DropdownMenu.DropdownItem
      icon={item.icon}
      disabled={item.disabled}
      onSelect={item.disabled ? undefined : handleSelect}
      onMouseLeave={() => setArmed(false)}
      className={cn(
        item.disabled && disabledItemStyle,
        armed &&
          "bg-error-600 hover:bg-error-500 active:bg-error-500 data-[highlighted]:bg-error-500 [&_span]:text-white [&_svg]:text-white"
      )}
    >
      {armed ? "Confirm" : item.label}
    </DropdownMenu.DropdownItem>
  )
}

const titleStyle = "min-w-0 grow text-body-bold font-body-bold text-default-font"

export const EditableTitle = ({
  title,
  onRename,
  renameRequested = false,
  onRenameSettled,
}: {
  title: string
  onRename: (title: string) => void
  renameRequested?: boolean
  onRenameSettled?: () => void
}) => {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null && !renameRequested) {
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

  const value = draft ?? ""

  const close = () => {
    setDraft(null)
    onRenameSettled?.()
  }

  const commit = () => {
    const next = value.trim()
    close()
    if (next !== "" && next !== title) onRename(next)
  }

  return (
    <input
      autoFocus
      aria-label="Document title"
      placeholder="Name this document"
      value={value}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit()
        if (e.key === "Escape") close()
      }}
      className={cn(titleStyle, "bg-transparent outline-none placeholder:text-neutral-400")}
    />
  )
}

export const FileHeader = ({
  title,
  date,
  tags = [],
  onRemoveTag,
  menuGroups = [],
  onTitleClick,
  onRename,
  renameRequested,
  onRenameSettled,
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
      <EditableTitle
        title={title}
        onRename={onRename}
        renameRequested={renameRequested}
        onRenameSettled={onRenameSettled}
      />
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
      {menuGroups.some((group) => group.length > 0) && (
        <SubframeCore.DropdownMenu.Root>
          <SubframeCore.DropdownMenu.Trigger asChild>
            <IconButton size="small" icon={<MoreHorizontal />} />
          </SubframeCore.DropdownMenu.Trigger>
          <SubframeCore.DropdownMenu.Portal>
            <SubframeCore.DropdownMenu.Content side="bottom" align="end" sideOffset={4} asChild>
              <DropdownMenu>
                {menuGroups.map((group, index) => (
                  <Fragment key={index}>
                    {index > 0 && <DropdownMenu.DropdownDivider />}
                    {group.map((item) =>
                      item.confirm ? (
                        <ConfirmMenuItem key={item.label} item={item} />
                      ) : (
                        <PlainMenuItem key={item.label} item={item} />
                      )
                    )}
                  </Fragment>
                ))}
              </DropdownMenu>
            </SubframeCore.DropdownMenu.Content>
          </SubframeCore.DropdownMenu.Portal>
        </SubframeCore.DropdownMenu.Root>
      )}
    </div>
  </div>
)
