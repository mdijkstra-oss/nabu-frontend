import { Bookmark } from "lucide-react"
import { cn } from "~/ui/utils"

interface BookmarkBtnProps {
  saved: boolean
  onToggle: () => void
  className?: string
}

export const BookmarkBtn = ({ saved, onToggle, className }: BookmarkBtnProps) => (
  <button
    type="button"
    aria-label={saved ? "Remove from saved" : "Save search"}
    onClick={(e) => {
      e.stopPropagation()
      onToggle()
    }}
    className={cn(
      "flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-md border-none bg-transparent",
      saved ? "text-success-600" : "text-neutral-400 hover:text-success-700",
      className
    )}
  >
    <Bookmark className={cn("h-4 w-4", saved && "[&_path]:fill-current")} />
  </button>
)
