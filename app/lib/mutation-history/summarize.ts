import type { HistoryEntry, HistoryVerb } from "./types"
import { presentEntry } from "./presentation"
import { toDisplayName } from "~/lib/files/filename"

const verbPast: Record<HistoryVerb, string> = {
  added: "Added",
  created: "Created",
  removed: "Removed",
  deleted: "Deleted",
  updated: "Updated",
  renamed: "Renamed",
}

const pluralEntity: Record<string, string> = {
  annotation: "annotations",
  code: "codes",
  tag: "tags",
  text: "text edits",
  file: "files",
}

const singleSummary = (entry: HistoryEntry): string => {
  const { verbLabel, entityLabel } = presentEntry(entry)
  return `${verbLabel}: ${entityLabel}`
}

const distinctPaths = (entries: HistoryEntry[]): string[] => [
  ...new Set(entries.map((e) => e.path)),
]

const scopeLabel = (entries: HistoryEntry[]): string => {
  const paths = distinctPaths(entries)
  return paths.length === 1 ? `in ${toDisplayName(paths[0])}` : `across ${paths.length} files`
}

const isUniform = (entries: HistoryEntry[]): boolean =>
  entries.every((e) => e.verb === entries[0].verb && e.entityKind === entries[0].entityKind)

const pluralNoun = (entityKind: string): string => pluralEntity[entityKind] ?? `${entityKind}s`

const uniformPhrase = (entries: HistoryEntry[]): string => {
  const { verb, entityKind } = entries[0]
  return `${verbPast[verb]} ${entries.length} ${pluralNoun(entityKind)}`
}

export const summarizeEdits = (entries: HistoryEntry[]): string => {
  if (entries.length === 0) return ""
  if (entries.length === 1) return singleSummary(entries[0])
  const scope = scopeLabel(entries)
  return isUniform(entries)
    ? `${uniformPhrase(entries)} ${scope}`
    : `${entries.length} changes ${scope}`
}
