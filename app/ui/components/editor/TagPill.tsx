"use client"

import { Check } from "lucide-react"
import * as SubframeCore from "@subframe/core"
import { TooltipWrap } from "~/ui/components/TooltipWrap"
import { cn } from "~/ui/utils"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { getTagDisplay } from "~/domain/data-blocks/settings/tags/selectors"
import { solidBackground } from "~/ui/theme/radix"

export const TagDot = ({ tag }: { tag: TagDefinition }) => (
  <TooltipWrap text={getTagDisplay(tag)}>
    <span
      className="h-2.5 w-2.5 flex-none rounded-full"
      style={{ backgroundColor: solidBackground(tag.color) }}
    />
  </TooltipWrap>
)

interface TagPillProps {
  tags: TagDefinition[]
  availableTags?: TagDefinition[]
  onToggleTag?: (tagId: string, enabled: boolean) => void
}

const pillStyle =
  "flex flex-none items-center gap-1 rounded-full bg-neutral-100 p-1 transition-colors"

const TagToggleRow = ({
  tag,
  enabled,
  onToggle,
}: {
  tag: TagDefinition
  enabled: boolean
  onToggle: () => void
}) => (
  <button
    type="button"
    onClick={onToggle}
    className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-3 hover:bg-neutral-100 active:bg-neutral-50"
  >
    <span
      className="h-2.5 w-2.5 flex-none rounded-full"
      style={{ backgroundColor: solidBackground(tag.color) }}
    />
    <span className="line-clamp-1 grow text-left text-body font-body text-default-font">
      {getTagDisplay(tag)}
    </span>
    {enabled && <Check className="h-3.5 w-3.5 flex-none text-brand-600" />}
  </button>
)

export const TagPill = ({ tags, availableTags = [], onToggleTag }: TagPillProps) => {
  const interactive = onToggleTag !== undefined && availableTags.length > 0
  if (tags.length === 0 && !interactive) return null

  const enabledIds = new Set(tags.map((tag) => tag.id))
  const dots = (
    <span
      className={cn(pillStyle, interactive && "cursor-default hover:bg-neutral-200")}
      aria-label="Tags"
    >
      {tags.map((tag) => (
        <TagDot key={tag.id} tag={tag} />
      ))}
      {tags.length === 0 && (
        <span className="h-2.5 w-2.5 flex-none rounded-full border border-neutral-300" />
      )}
    </span>
  )

  if (!interactive) return dots

  return (
    <SubframeCore.HoverCard.Root openDelay={150} closeDelay={200}>
      <SubframeCore.HoverCard.Trigger asChild>{dots}</SubframeCore.HoverCard.Trigger>
      <SubframeCore.HoverCard.Portal>
        <SubframeCore.HoverCard.Content side="bottom" align="start" sideOffset={4} asChild>
          <div className="z-50 flex min-w-[176px] flex-col items-start rounded-md border border-solid border-neutral-border bg-default-background px-1 py-1 shadow-lg">
            {availableTags.map((tag) => (
              <TagToggleRow
                key={tag.id}
                tag={tag}
                enabled={enabledIds.has(tag.id)}
                onToggle={() => onToggleTag(tag.id, !enabledIds.has(tag.id))}
              />
            ))}
          </div>
        </SubframeCore.HoverCard.Content>
      </SubframeCore.HoverCard.Portal>
    </SubframeCore.HoverCard.Root>
  )
}
