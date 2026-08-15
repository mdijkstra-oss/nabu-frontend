import type { z } from "zod"
import { findBlocksByLanguage, parseBlockJson } from "./parse"
import type { CodeBlock } from "./parse"

// Most migrations trigger on a json block whose content still matches an old
// shape. A migration whose trigger is a raw-markdown condition — content that is
// not a data block at all — declares a predicate instead.
export interface BlockMigration {
  blockType: string
  from: z.ZodType
  upgrade: (markdown: string) => string
}

export interface MarkdownMigration {
  matches: (markdown: string) => boolean
  upgrade: (markdown: string) => string
}

export type Migration = BlockMigration | MarkdownMigration

export interface MigrateResult {
  markdown: string
  changed: boolean
}

const blockMatchesOldSchema = (block: CodeBlock, from: z.ZodType): boolean => {
  const parsed = parseBlockJson(block)
  if (!parsed.ok) return false
  return from.safeParse(parsed.data).success
}

const isBlockMigration = (migration: Migration): migration is BlockMigration =>
  "blockType" in migration

export const shouldMigrate = (markdown: string, migration: Migration): boolean =>
  isBlockMigration(migration)
    ? findBlocksByLanguage(markdown, migration.blockType).some((block) =>
        blockMatchesOldSchema(block, migration.from)
      )
    : migration.matches(markdown)

export const migrateFile = (markdown: string, migrations: readonly Migration[]): MigrateResult => {
  const upgraded = migrations.reduce(
    (current, migration) =>
      shouldMigrate(current, migration) ? migration.upgrade(current) : current,
    markdown
  )
  return { markdown: upgraded, changed: upgraded !== markdown }
}
