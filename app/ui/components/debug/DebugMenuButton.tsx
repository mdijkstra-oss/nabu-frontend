"use client"

import type { ReactNode } from "react"
import { Bug, Check, Minimize, Trash2 } from "lucide-react"
import * as SubframeCore from "@subframe/core"
import { IconButton } from "~/ui/components/IconButton"
import { DropdownMenu } from "~/ui/components/DropdownMenu"
import { DEBUG_TOGGLES, type DebugOptions } from "~/ui/components/editor/debug-config"
import { clearAllCaches } from "~/lib/utils/storage-cache"

interface DebugMenuButtonProps {
  debugOptions: DebugOptions
  onToggleOption: (key: string) => void
  onRequestCompaction: () => void
}

const DEBUG_NOTICES: string[] = [
  "refine-code ignores annotations without vote block (pre-vote format)",
  "user-created annotations don't write vote yet",
]

const isActive = (options: DebugOptions, key: string): boolean => options[key] ?? false

const renderToggleItem = (
  key: string,
  label: string,
  icon: ReactNode,
  active: boolean,
  onToggle: (key: string) => void
) => (
  <DropdownMenu.DropdownItem
    key={key}
    icon={active ? <Check /> : icon}
    onClick={() => onToggle(key)}
  >
    {label}
  </DropdownMenu.DropdownItem>
)

export const DebugMenuButton = ({
  debugOptions,
  onToggleOption,
  onRequestCompaction,
}: DebugMenuButtonProps) => (
  <SubframeCore.DropdownMenu.Root>
    <SubframeCore.DropdownMenu.Trigger asChild>
      <IconButton
        variant="brand-tertiary"
        icon={<Bug />}
        className={
          isActive(debugOptions, "expanded")
            ? "!rounded-full [&_svg]:text-default-font"
            : "!rounded-full [&_svg]:text-subtext-color"
        }
      />
    </SubframeCore.DropdownMenu.Trigger>
    <SubframeCore.DropdownMenu.Portal>
      <SubframeCore.DropdownMenu.Content side="right" align="end" sideOffset={4} asChild>
        <DropdownMenu className="max-w-[320px]">
          {DEBUG_NOTICES.length > 0 && (
            <>
              <div className="flex w-full flex-col gap-0.5 px-3 py-1.5">
                {DEBUG_NOTICES.map((notice, i) => (
                  <span key={i} className="text-caption font-caption text-error-700">
                    • {notice}
                  </span>
                ))}
              </div>
              <DropdownMenu.DropdownDivider />
            </>
          )}
          {DEBUG_TOGGLES.map((t) =>
            renderToggleItem(t.key, t.label, t.icon, isActive(debugOptions, t.key), onToggleOption)
          )}
          <DropdownMenu.DropdownItem icon={<Minimize />} onClick={onRequestCompaction}>
            Force compaction
          </DropdownMenu.DropdownItem>
          <DropdownMenu.DropdownItem icon={<Trash2 />} onClick={clearAllCaches}>
            Clear IndexedDB caches
          </DropdownMenu.DropdownItem>
        </DropdownMenu>
      </SubframeCore.DropdownMenu.Content>
    </SubframeCore.DropdownMenu.Portal>
  </SubframeCore.DropdownMenu.Root>
)
