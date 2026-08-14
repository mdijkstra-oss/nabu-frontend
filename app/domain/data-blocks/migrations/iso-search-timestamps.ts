import { z } from "zod"
import type { Migration } from "~/lib/data-blocks/migrate"
import { findSingletonBlock, parseBlockJson, replaceBlock } from "~/lib/data-blocks/parse"

const epochCreatedAt = z.looseObject({
  searches: z.array(z.looseObject({ createdAt: z.unknown() })),
})

const hasEpochEntry = (data: z.infer<typeof epochCreatedAt>): boolean =>
  data.searches.some((e) => typeof e.createdAt === "number")

const oldSettingsShape = epochCreatedAt.refine(hasEpochEntry)

const toIso = (entry: Record<string, unknown>): Record<string, unknown> =>
  typeof entry.createdAt === "number"
    ? { ...entry, createdAt: new Date(entry.createdAt).toISOString() }
    : entry

const upgradeMarkdown = (markdown: string): string => {
  const block = findSingletonBlock(markdown, "json-settings")
  if (!block) return markdown

  const parsed = parseBlockJson<Record<string, unknown>>(block)
  if (!parsed.ok) return markdown

  if (!oldSettingsShape.safeParse(parsed.data).success) return markdown

  // The raw entries are mapped, not zod's parse output: looseObject re-orders keys,
  // and the rewrite should change one value, not the shape of the block.
  const searches = parsed.data.searches as Record<string, unknown>[]
  const upgraded = { ...parsed.data, searches: searches.map(toIso) }
  return replaceBlock(markdown, block, JSON.stringify(upgraded, null, 2))
}

export const isoSearchTimestamps: Migration = {
  blockType: "json-settings",
  from: oldSettingsShape,
  upgrade: upgradeMarkdown,
}
