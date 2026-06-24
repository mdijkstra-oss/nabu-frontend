import { Loader2 } from "lucide-react"

interface StatusCountLineProps {
  loading: boolean
  statusText: string | null
}

export const StatusCountLine = ({ loading, statusText }: StatusCountLineProps) => (
  <div className="flex min-h-[30px] items-center gap-2">
    {loading && <Loader2 className="h-4 w-4 animate-spin text-subtext-color" />}
    {statusText && <span className="text-body font-body text-subtext-color">{statusText}</span>}
  </div>
)
