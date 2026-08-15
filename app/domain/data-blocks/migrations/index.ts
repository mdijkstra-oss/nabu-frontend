import type { Migration } from "~/lib/data-blocks/migrate"
import { extractAnnotations } from "./extract-annotations"
import { wrapAnnotations } from "./wrap-annotations"
import { isoSearchTimestamps } from "./iso-search-timestamps"
import { convertPipeTables } from "./convert-pipe-tables"

export const migrations: readonly Migration[] = [
  extractAnnotations,
  wrapAnnotations,
  isoSearchTimestamps,
  convertPipeTables,
]
