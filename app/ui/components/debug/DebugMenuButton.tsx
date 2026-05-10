"use client"

import type { ReactNode } from "react"
import { Bug, Check, Minimize } from "lucide-react"
import * as SubframeCore from "@subframe/core"
import { IconButton } from "~/ui/components/IconButton"
import { DropdownMenu } from "~/ui/components/DropdownMenu"
import { DEBUG_TOGGLES, type DebugOptions } from "~/ui/components/editor/debug-config"

interface DebugMenuButtonProps {
  debugOptions: DebugOptions
  onToggleOption: (key: string) => void
  onRequestCompaction: () => void
}

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
        <DropdownMenu>
          {DEBUG_TOGGLES.map((t) =>
            renderToggleItem(t.key, t.label, t.icon, isActive(debugOptions, t.key), onToggleOption)
          )}
          <DropdownMenu.DropdownItem icon={<Minimize />} onClick={onRequestCompaction}>
            Force compaction
          </DropdownMenu.DropdownItem>
        </DropdownMenu>
      </SubframeCore.DropdownMenu.Content>
    </SubframeCore.DropdownMenu.Portal>
  </SubframeCore.DropdownMenu.Root>
)
