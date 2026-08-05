import type { ReactNode } from "react"
import { Bug, Cloud, Code, Activity, Bot, Filter, Table, TriangleAlert } from "lucide-react"
import type { DebugOptions } from "~/lib/debug/options"

interface DebugToggle {
  key: string
  label: string
  description: string
  icon: ReactNode
  defaultValue: boolean
}

// WHY: consumers read these flags via useDebugOptions()/isDebugOn(key) at the
// point of use. Do not thread a per-toggle prop through component trees — add
// the entry here and read it inline where it matters.
export const DEBUG_TOGGLES: DebugToggle[] = [
  {
    key: "expanded",
    label: "Hidden files",
    description: "Show hidden files in the project tree.",
    icon: <Bug />,
    defaultValue: false,
  },
  {
    key: "persistToServer",
    label: "Server persistence",
    description: "Sync chat blocks to the server. Off keeps everything local.",
    icon: <Cloud />,
    defaultValue: true,
  },
  {
    key: "renderAsJson",
    label: "JSON rendering",
    description: "Render search results as raw JSON instead of formatted UI.",
    icon: <Code />,
    defaultValue: false,
  },
  {
    key: "showStreamPanel",
    label: "Stream panel",
    description: "Open the agent block stream debug panel.",
    icon: <Activity />,
    defaultValue: false,
  },
  {
    key: "reasoningSummaryAuto",
    label: "Reasoning summary",
    description: "Use auto reasoning summary verbosity instead of concise.",
    icon: <Bot />,
    defaultValue: false,
  },
  {
    key: "skipCache",
    label: "Skip cache",
    description: "Bypass the local embedding/result cache and refetch.",
    icon: <Filter />,
    defaultValue: false,
  },
  {
    key: "showQueryResults",
    label: "Query results",
    description: "Show raw query result rows below chart blocks.",
    icon: <Table />,
    defaultValue: false,
  },
  {
    key: "showReviewStats",
    label: "Review stats",
    description: "Show per-model agreement stats on reviewed annotations.",
    icon: <TriangleAlert />,
    defaultValue: false,
  },
  {
    key: "showModelIndex",
    label: "Model index in review",
    description: "Show the model index alongside each reviewer pick.",
    icon: <Bot />,
    defaultValue: false,
  },
  {
    key: "skipHydeGeneration",
    label: "Step 0 — Skip HyDE generation (use raw query)",
    description: "Skip LLM HyDE expansion. Embed the raw query text once per language.",
    icon: <Filter />,
    defaultValue: false,
  },
  {
    key: "skipMerge",
    label: "Step 3 — Skip merge (capped chunks, no fuse)",
    description: "Skip merging byte-overlapping chunks into regions. Cap-by-file still runs.",
    icon: <Filter />,
    defaultValue: false,
  },
  {
    key: "skipFilter",
    label: "Step 4 — Skip filter (raw embeddings)",
    description: "Skip the semantic filter step. Return raw embedding matches.",
    icon: <Filter />,
    defaultValue: false,
  },
  {
    key: "skipBarrenCheck",
    label: "Step 4 — Skip barren cutoff (keep filtering)",
    description: "Don't stop early when filter batches return no hits. Keep filtering.",
    icon: <Filter />,
    defaultValue: false,
  },
  {
    key: "skipScoutFilter",
    label: "Step 4 — Skip scout pre-filter (framework)",
    description:
      "Skip the per-file framework scout that drops off-topic chunks before semantic filter.",
    icon: <Filter />,
    defaultValue: false,
  },
  {
    key: "skipAnnotationExtend",
    label: "Step 6 — Skip annotation extension",
    description: "Don't extend hits to cover overlapping annotation ranges.",
    icon: <Filter />,
    defaultValue: false,
  },
  {
    key: "showHitScore",
    label: "Show hit score",
    description: "Show the score below each search result block (bold, 4 decimals).",
    icon: <Filter />,
    defaultValue: false,
  },
  {
    key: "fileSpecificCandidates",
    label: "Suggest passages in the open file",
    description:
      "Adds a button to each code that finds passages in the currently open file that may fit it.",
    icon: <Filter />,
    defaultValue: false,
  },
  {
    key: "embeddingsLimitOnePage",
    label: "Embeddings limit one page",
    description:
      "Cap fused embedding results at one page (SEARCH_PAGE_SIZE). Default scales by corpus.",
    icon: <Filter />,
    defaultValue: false,
  },
]

export type { DebugOptions } from "~/lib/debug/options"

export const DEFAULT_DEBUG_OPTIONS: DebugOptions = Object.fromEntries(
  DEBUG_TOGGLES.map((t) => [t.key, t.defaultValue])
)
