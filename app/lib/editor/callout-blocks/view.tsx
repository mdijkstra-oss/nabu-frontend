"use client"

import { Trash2 } from "lucide-react"
import type { CalloutBlock } from "~/domain/data-blocks/callout/schema"
import type { RadixColor } from "~/ui/theme/radix"
import { solidBackground } from "~/ui/theme/radix"
import { IconButton } from "~/ui/components/IconButton"
import { CalloutContent } from "./content"

interface CalloutBlockViewProps {
  data: CalloutBlock
  onDelete: () => void
  readOnly?: boolean
}

export const CalloutBlockView = ({ data, onDelete, readOnly = false }: CalloutBlockViewProps) => (
  <div className="group/callout flex w-full items-start overflow-hidden rounded-lg border border-solid border-neutral-border bg-default-background relative my-2">
    <div
      className="flex w-1 flex-none absolute left-0 top-0 bottom-0"
      style={{ backgroundColor: solidBackground(data.color as RadixColor) }}
    />
    {!readOnly && (
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover/callout:opacity-100 transition-opacity">
        <IconButton variant="neutral-tertiary" size="small" icon={<Trash2 />} onClick={onDelete} />
      </div>
    )}
    <div className="flex grow shrink-0 basis-0 flex-col items-start gap-4 pl-5 pr-4 py-4">
      <div className="flex w-full items-start gap-3">
        <CalloutContent data={data} />
      </div>
    </div>
  </div>
)
