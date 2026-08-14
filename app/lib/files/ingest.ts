import { updateFileRaw } from "~/lib/files/store"
import { migrateFile } from "~/lib/data-blocks/migrate"
import { migrations } from "~/domain/data-blocks/migrations"
import { FileCorruptionError } from "~/lib/files/errors"
import type { ValidationError } from "~/lib/data-blocks/validate"

export type IngestResult =
  | { ok: true; migrated: boolean }
  | { ok: false; errors: ValidationError[] }

type StoreWrite = (path: string, content: string) => void

// Raw content is hostile until parsed: a block can match a migration's old-shape
// schema and still hold values the upgrade chokes on, so a migration crash is a
// rejection of the file, never an escaping throw.
export const ingestFile = (
  path: string,
  content: string,
  write: StoreWrite = updateFileRaw
): IngestResult => {
  let migrated: ReturnType<typeof migrateFile>
  try {
    migrated = migrateFile(content, migrations)
  } catch (e) {
    return {
      ok: false,
      errors: [{ block: "migration", message: e instanceof Error ? e.message : String(e) }],
    }
  }
  try {
    write(path, migrated.markdown)
  } catch (e) {
    if (e instanceof FileCorruptionError) return { ok: false, errors: e.errors }
    throw e
  }
  return { ok: true, migrated: migrated.changed }
}
