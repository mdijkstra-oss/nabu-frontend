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
    key: "showReviewStats",
    label: "Review stats",
    icon: <TriangleAlert />,
    defaultValue: false,
  },
  {
    key: "showModelIndex",
    label: "Model index in review",
    icon: <Bot />,
    defaultValue: false,
  },
  {
    key: "skipFilter",
    label: "Raw embeddings (skip filter)",
    icon: <Filter />,
    defaultValue: false,
  },
]

export type DebugOptions = Record<string, boolean>

export const DEFAULT_DEBUG_OPTIONS: DebugOptions = Object.fromEntries(
  DEBUG_TOGGLES.map((t) => [t.key, t.defaultValue])
)
