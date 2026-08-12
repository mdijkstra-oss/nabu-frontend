import { settingsSchema, type Settings } from "./schema"
import type { BlockTypeConfig } from "~/lib/data-blocks/definition"

export const jsonSettings: BlockTypeConfig<Settings> = {
  schema: settingsSchema,
  readonly: [],
  immutable: {},
  constraints: ["tags: each tag label must be unique"],
  renderer: "hidden",
  singleton: true,
  projected: true,
  allowedFiles: ["settings.hidden.md"],
  idPaths: [
    { path: "tags.*.id", prefix: "tag" },
    { path: "searches.*.id", prefix: "search" },
  ],
  asyncValidate: async (parsed) => {
    const { validateSearchSql } = await import("./searches/validation")
    return validateSearchSql(parsed)
  },
}
