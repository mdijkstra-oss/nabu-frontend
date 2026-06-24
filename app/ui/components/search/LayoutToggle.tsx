import { Layers, Rows3 } from "lucide-react"
import type { LayoutMode } from "~/lib/ui/card-layout"
import { cn } from "~/ui/utils"

const modes: { mode: LayoutMode; label: string; icon: typeof Layers }[] = [
  { mode: "stacked", label: "Stacked view", icon: Layers },
  { mode: "flat", label: "List view", icon: Rows3 },
]

interface LayoutToggleProps {
  mode: LayoutMode
  onChange: (mode: LayoutMode) => void
}

export const LayoutToggle = ({ mode, onChange }: LayoutToggleProps) => (
  <div className="inline-flex flex-none gap-1 rounded-lg border border-solid border-neutral-border bg-default-background p-1">
    {modes.map(({ mode: m, label, icon: Icon }) => (
      <button
        key={m}
        type="button"
        aria-label={label}
        onClick={() => onChange(m)}
        className={cn(
          "flex h-7 w-8 items-center justify-center rounded-md transition-colors",
          mode === m ? "bg-neutral-900 text-white" : "text-subtext-color hover:bg-neutral-50"
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
    ))}
  </div>
)
