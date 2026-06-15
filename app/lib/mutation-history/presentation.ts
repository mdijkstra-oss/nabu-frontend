import type { ComponentType } from "react"
import { Plus, Edit3, Trash, Tag, Type, FileText, ArrowRight, User, Bot } from "lucide-react"
import type { HistoryEntry, HistoryVerb, HistoryActor } from "./types"
import { toDisplayName } from "~/lib/files/filename"

type IconVariant = "brand" | "neutral" | "error" | "success" | "warning"

interface EntryPresentation {
  icon: ComponentType<{ className?: string }>
  variant: IconVariant
  verbLabel: string
  entityLabel: string
  subtitle: string
}

export const truncateLabel = (text: string, max = 60): string =>
  text.length <= max ? text : text.slice(0, max) + "…"

const verbIcon: Record<HistoryVerb, ComponentType<{ className?: string }>> = {
  added: Plus,
  created: Plus,
  removed: Trash,
  deleted: Trash,
  updated: Edit3,
  renamed: ArrowRight,
}

const verbVariant: Record<HistoryVerb, IconVariant> = {
  added: "success",
  created: "success",
  removed: "error",
  deleted: "error",
  updated: "neutral",
  renamed: "neutral",
}

const entityKindVerb: Record<string, Record<string, string>> = {
  annotation: {
    added: "Added annotation",
    removed: "Removed annotation",
    updated: "Updated annotation",
  },
  code: {
    added: "Applied code",
    removed: "Removed code",
    updated: "Updated code",
    created: "Created code",
  },
  tag: { added: "Added tag", removed: "Removed tag" },
  text: { updated: "Updated text" },
  file: { created: "Created file", deleted: "Deleted file", renamed: "Renamed file" },
}

const formatEntityVerb = (entry: HistoryEntry): string =>
  entityKindVerb[entry.entityKind]?.[entry.verb] ?? `${entry.verb} ${entry.entityKind}`

const entityKindIcon: Record<string, ComponentType<{ className?: string }>> = {
  tag: Tag,
  text: Type,
  file: FileText,
}

const getIcon = (entry: HistoryEntry): ComponentType<{ className?: string }> =>
  entityKindIcon[entry.entityKind] ?? verbIcon[entry.verb]

export const actorIcon: Record<HistoryActor, ComponentType<{ className?: string }>> = {
  user: User,
  ai: Bot,
}

export const presentEntry = (entry: HistoryEntry): EntryPresentation => ({
  icon: getIcon(entry),
  variant: verbVariant[entry.verb],
  verbLabel: formatEntityVerb(entry),
  entityLabel: truncateLabel(entry.label),
  subtitle: toDisplayName(entry.newPath ?? entry.path),
})
