import type { TagDefinition } from "../schema"
import { getSettings } from "../selectors"
import { SETTINGS_FILE } from "~/lib/files/filename"
import type { FileStore } from "~/lib/files/store"
import { humanize } from "~/lib/text/humanize"

export const getTagDefinitions = (files: FileStore): TagDefinition[] =>
  getSettings(files[SETTINGS_FILE] ?? "")?.tags ?? []

export const findTagDefinitionById = (files: FileStore, id: string): TagDefinition | undefined =>
  getTagDefinitions(files).find((t) => t.id === id)

export const findTagDefinitionByLabel = (
  files: FileStore,
  label: string
): TagDefinition | undefined => getTagDefinitions(files).find((t) => t.label === label)

export const getTagDisplay = (tag: TagDefinition): string => humanize(tag.label)

export const getTagDisplayById = (settingsRaw: string, id: string): string | undefined => {
  const tag = (getSettings(settingsRaw)?.tags ?? []).find((t) => t.id === id)
  return tag ? getTagDisplay(tag) : undefined
}
