import type { ReactNode } from "react"
import { Bug, Cloud, Code, Activity, Bot, Filter, Table, TriangleAlert } from "lucide-react"

interface DebugToggle {
  key: string
  label: string
  icon: ReactNode
  defaultValue: boolean
}

export const DEBUG_TOGGLES: DebugToggle[] = [
  { key: "expanded", label: "Hidden files", icon: <Bug />, defaultValue: false },
  {
    key: "persistToServer",
    label: "Server persistence",
    icon: <Cloud />,
    defaultValue: true,
  },
  { key: "renderAsJson", label: "JSON rendering", icon: <Code />, defaultValue: false },
  { key: "showStreamPanel", label: "Stream panel", icon: <Activity />, defaultValue: false },
  {
    key: "reasoningSummaryAuto",
    label: "Reasoning summary",
    icon: <Bot />,
    defaultValue: false,
  },
  { key: "stepCompaction", label: "Step compaction", icon: <Filter />, defaultValue: false },
  {
    key: "skipCache",
    label: "Skip cache",
    icon: <Filter />,
    defaultValue: false,
  },
  {
    key: "showQueryResults",
    label: "Query results",
    icon: <Table />,
    defaultValue: false,
  },
  {
    key: "showRemovalCounts",
    label: "Removal counts",
    icon: <TriangleAlert />,
    defaultValue: false,
  },
]

export type DebugOptions = Record<string, boolean>

export const DEFAULT_DEBUG_OPTIONS: DebugOptions = Object.fromEntries(
  DEBUG_TOGGLES.map((t) => [t.key, t.defaultValue])
)
