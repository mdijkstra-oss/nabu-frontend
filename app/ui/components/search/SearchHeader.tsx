"use client"

import { Search, Loader2 } from "lucide-react"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { TextField } from "~/ui/components/TextField"
import { TagBadge } from "~/ui/components/TagBadge"

interface SearchHeaderProps {
  title: string
  description: string
  tags: TagDefinition[]
  activeTags: Set<string>
  onToggleTag: (id: string) => void
  statusText: string | null
  loading: boolean
}

export const SearchHeader = ({
  title,
  description,
  tags,
  activeTags,
  onToggleTag,
  statusText,
  loading,
}: SearchHeaderProps) => (
  <div className="flex w-full flex-col items-start gap-4">
    <div className="flex w-full flex-col gap-1">
      <span className="text-heading-1 font-heading-1 text-default-font">{title}</span>
      {statusText && (
        <span className="flex items-center gap-2 text-caption font-caption text-subtext-color">
          {loading && <Loader2 className="animate-spin text-subtext-color" />}
          {statusText}
        </span>
      )}
    </div>
    <div className="flex w-full flex-col items-start rounded-lg border border-solid border-neutral-300 px-3 py-2 shadow-sm">
      <div className="flex w-full items-center gap-2">
        <Search className="text-[16px] leading-[24px] text-neutral-400" />
        <TextField
          className="h-auto grow shrink-0 basis-0 [&_div]:border-none [&_div]:bg-transparent"
          variant="outline"
          label=""
          helpText=""
          icon={null}
          disabled
        >
          <TextField.Input className="text-[14px] leading-[20px]" value={description} disabled />
        </TextField>
      </div>
    </div>
    {tags.length > 0 && (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body font-body text-subtext-color">Filter by:</span>
        {tags.map((tag) => {
          const active = activeTags.has(tag.id)
          const isLastActive = active && activeTags.size === 1
          return (
            <TagBadge
              key={tag.id}
              tag={tag}
              active={active}
              disabled={isLastActive}
              onClick={() => onToggleTag(tag.id)}
            />
          )
        })}
      </div>
    )}
  </div>
)
