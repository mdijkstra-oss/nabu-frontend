"use client"

import { Search, Plus, X } from "lucide-react"
import { Button } from "~/ui/components/Button"
import { TextField } from "~/ui/components/TextField"

interface SidebarHeaderProps {
  title: string
  filterPlaceholder: string
  filterValue: string
  onFilterChange: (value: string) => void
  onNew?: () => void
}

export const SidebarHeader = ({
  title,
  filterPlaceholder,
  filterValue,
  onFilterChange,
  onNew,
}: SidebarHeaderProps) => (
  <div className="flex w-full flex-col items-start gap-2 border-b border-solid border-neutral-border px-4 py-4">
    <div className="flex w-full items-center justify-between">
      <span className="text-heading-2 font-heading-2 font-bold text-default-font">{title}</span>
      {onNew && <Button variant="brand-primary" size="small" icon={<Plus />} onClick={onNew} />}
    </div>
    <TextField
      className="h-auto w-full flex-none"
      variant="filled"
      label=""
      helpText=""
      icon={<Search className="text-slate-950" />}
      iconRight={
        filterValue ? (
          <button
            type="button"
            className="flex items-center justify-center rounded-sm hover:bg-neutral-200 p-0.5"
            onClick={() => onFilterChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null
      }
    >
      <TextField.Input
        placeholder={filterPlaceholder}
        value={filterValue}
        onChange={(e) => onFilterChange(e.target.value)}
      />
    </TextField>
  </div>
)
