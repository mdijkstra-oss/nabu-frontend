import { deleteFile, renameFile, withoutPersist, schedulePersist } from "~/lib/files/store"
import { ingestFile } from "~/lib/files/ingest"
import type { Command } from "./types"
import { exhaustive } from "~/lib/utils/exhaustive"

// Returns the path to persist back, which is one the migration rewrote on the way in.
const applyCommandInner = (command: Command): string | undefined => {
  const { action, path, newPath, content } = command
  if (!path) return undefined

  switch (action) {
    case "WriteFile": {
      if (content === undefined) return undefined
      const result = ingestFile(path, content)
      // A corrupt synced file is reported and skipped; the command still counts
      // toward file-loading progress at the caller, so boot proceeds without it.
      if (!result.ok) {
        console.error(`[sync] rejected corrupt file ${path}:`, result.errors)
        return undefined
      }
      return result.migrated ? path : undefined
    }

    case "DeleteFile":
      deleteFile(path)
      return undefined

    case "RenameFile":
      if (newPath) renameFile(path, newPath)
      return undefined

    // Sent once as the file count ahead of the initial sync, and carries no path.
    case "SyncMeta":
      return undefined

    default:
      return exhaustive(action)
  }
}

export const applyCommand = (command: Command): void => {
  const migratedPath = withoutPersist(() => applyCommandInner(command))
  if (migratedPath) schedulePersist(migratedPath)
}
