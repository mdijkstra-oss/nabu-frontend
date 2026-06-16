"use client"

import type { ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Button } from "~/ui/components/Button"
import { DropdownMenu } from "~/ui/components/DropdownMenu"
import { IconButton } from "~/ui/components/IconButton"
import { TagBadge } from "~/ui/components/TagBadge"
import { MoreHorizontal, Plus } from "lucide-react"
import * as SubframeCore from "@subframe/core"
import { cn } from "~/ui/utils"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { formatDisplayDate } from "~/lib/format/date"

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
  menuItems?: MenuItem[]
  onAddTag?: () => void
  className?: string
}

const tagAnimation = {
  initial: { opacity: 0, scale: 0.8 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.8 },
  transition: { type: "spring" as const, stiffness: 500, damping: 35 },
}

export const FileHeader = ({
  title,
  date,
  tags = [],
  onRemoveTag,
  menuItems = [],
  onAddTag,
  className,
}: FileHeaderProps) => {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-start gap-3 px-6 py-4 shadow-header-divider",
        className
      )}
    >
      <div className="flex w-full items-start gap-2">
        <div className="flex grow shrink-0 basis-0 items-center gap-2">
          <span className="text-heading-2 font-heading-2 text-default-font">{title}</span>
        </div>
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
      {date && (
        <span className="text-caption font-caption text-subtext-color">
          {formatDisplayDate(date)}
        </span>
      )}
      {(tags.length > 0 || onAddTag) && (
        <div className="flex w-full flex-wrap items-center gap-2">
          <AnimatePresence initial={false}>
            {tags.map((tag) => (
              <motion.span key={tag.id} {...tagAnimation}>
                <TagBadge
                  tag={tag}
                  onRemove={onRemoveTag ? () => onRemoveTag(tag.id) : undefined}
                />
              </motion.span>
            ))}
          </AnimatePresence>
          {onAddTag && (
            <Button variant="neutral-tertiary" size="small" icon={<Plus />} onClick={onAddTag}>
              Add tag
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
