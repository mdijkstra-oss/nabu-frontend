"use client"

import type { ReactNode } from "react"
import { IconButton } from "~/ui/components/IconButton"
import { cn } from "~/ui/utils"

interface ToolbarItem {
  icon: ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
}

type ToolbarGroup = ToolbarItem[]

interface EditorToolbarProps {
  groups: ToolbarGroup[]
  className?: string
}

const Divider = () => (
  <div className="flex w-px flex-none flex-col items-center gap-2 self-stretch bg-neutral-border" />
)

export const EditorToolbar = ({ groups, className }: EditorToolbarProps) => (
  <div className="flex w-full items-center justify-center">
    <div
      className={cn(
        "flex items-start gap-1 rounded-full border border-solid border-neutral-border bg-default-background px-2 py-2 shadow-md",
        className
      )}
    >
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="flex items-start gap-1">
          {groupIndex > 0 && <Divider />}
          {group.map((item, itemIndex) => (
            <IconButton
              key={itemIndex}
              size="small"
              icon={item.icon}
              variant={item.active ? "brand-secondary" : "neutral-tertiary"}
              onClick={item.onClick}
              disabled={item.disabled}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
)
