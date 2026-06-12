import {
  updateFileRaw,
  deleteFile,
  renameFile,
  withoutPersist,
  schedulePersist,
} from "~/lib/files/store"
import { migrateFile } from "~/lib/data-blocks/migrate"
import { migrations } from "~/domain/data-blocks/migrations"
import type { Command } from "./types"
import { exhaustive } from "~/lib/utils/exhaustive"

interface ResolvedContent {
  path: string
  content: string
}

const resolveContent = (command: Command): ResolvedContent | undefined => {
  const { action, path, content } = command
  if (!path) return undefined

  switch (action) {
    case "CreateFile":
    case "UpdateFile":
    case "WriteFile":
      return content !== undefined ? { path, content } : undefined

    case "DeleteFile":
    case "RenameFile":
    case "Commit":
    case "SyncMeta":
      return undefined

    default:
      return exhaustive(action)
  }
}

const applyCommandInner = (command: Command): string | undefined => {
  const { action, path, newPath } = command
  if (!path) return undefined

  const resolved = resolveContent(command)
  if (resolved) {
    const migrated = migrateFile(resolved.content, migrations)
    updateFileRaw(resolved.path, migrated.markdown)
    return migrated.changed ? resolved.path : undefined
  }

  switch (action) {
    case "DeleteFile":
      deleteFile(path)
      return undefined

    case "RenameFile":
      if (!newPath) return undefined
      renameFile(path, newPath)
      return undefined

    case "Commit":
    case "SyncMeta":
      return undefined

    case "CreateFile":
    case "UpdateFile":
    case "WriteFile":
      return undefined

    default:
      return exhaustive(action)
  }
}

export const applyCommand = (command: Command): void => {
  const migratedPath = withoutPersist(() => applyCommandInner(command))
  if (migratedPath) schedulePersist(migratedPath)
}
