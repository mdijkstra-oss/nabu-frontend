"use client"

import { elementBackground, type RadixColor } from "~/ui/theme/radix"
import { annotationIcon as AnnotationIcon } from "~/domain/data-blocks/attributes/schema"
import { SelectionBar } from "./SelectionBar"

interface DocumentItemProps {
  title: string
  editedAt: string
  annotationCount?: number
  color?: RadixColor
  selected?: boolean
  checked?: boolean
  onClick?: () => void
}

const hasMetaRow = (editedAt: string, annotationCount: number): boolean =>
  editedAt.length > 0 || annotationCount > 0

export function DocumentItem({
  title,
  editedAt,
  annotationCount = 0,
  color = "lime",
  selected = false,
  checked = false,
  onClick,
}: DocumentItemProps) {
  const showMeta = hasMetaRow(editedAt, annotationCount)
  return (
    <div
      style={{ "--tag-element": elementBackground(color) } as React.CSSProperties}
      className={`group flex w-full min-h-[3rem] flex-col pl-2 pr-3 py-2 cursor-pointer relative ${
        showMeta ? "items-start gap-1 justify-start" : "justify-center"
      } ${
        selected
          ? "bg-[var(--tag-element)] group-hover:bg-transparent hover:!bg-[var(--tag-element)]"
          : "hover:bg-[var(--tag-element)]"
      }`}
      onClick={onClick}
    >
      <SelectionBar color={color} active={selected} checked={checked} />
      <span className="w-full flex-none line-clamp-1 text-body font-body text-default-font">
        {title}
      </span>
      {showMeta && (
        <div className="flex w-full items-center gap-1">
          <span className="text-caption font-caption text-subtext-color">{editedAt}</span>
          {annotationCount > 0 && (
            <span className="flex items-center gap-0.5 text-caption font-caption text-subtext-color ml-auto">
              <AnnotationIcon className="w-3 h-3" />
              {annotationCount}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
