export type Action = "WriteFile" | "DeleteFile" | "RenameFile" | "SyncMeta"

export interface Command {
  action: Action
  path?: string
  newPath?: string
  content?: string
  fileCount?: number
}

export type CommandResult = { ok: true } | { ok: false; error: string }
