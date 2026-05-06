import { z } from "zod"
import { slug, radixColor } from "~/domain/data-blocks/attributes/schema"
import { ICON_NAMES } from "~/ui/theme/icons"
import { SearchEntrySchema } from "~/domain/search/types"
import { CorpusDescriptionSchema } from "~/domain/corpus/types"

export const TagDefinition = z.object({
  id: z.string(),
  label: slug,
  display: z.string(),
  color: radixColor,
  icon: z.enum(ICON_NAMES),
})

export type TagDefinition = z.infer<typeof TagDefinition>

const deduplicateByLabel = (tags: TagDefinition[]): TagDefinition[] => {
  const seen = new Set<string>()
  return tags.filter((t) => (!seen.has(t.label) ? (seen.add(t.label), true) : false))
}

const BaseSettings = z.object({
  tags: z.array(TagDefinition).optional(),
  searches: z.array(SearchEntrySchema).optional(),
  corpusDescriptions: z.array(CorpusDescriptionSchema).optional(),
})

export const settingsSchema = () =>
  BaseSettings.transform((s) => ({
    ...s,
    ...(s.tags !== undefined && { tags: deduplicateByLabel(s.tags) }),
  }))

export const Settings = settingsSchema()
export type Settings = z.infer<typeof BaseSettings>
