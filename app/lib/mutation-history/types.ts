export type HistoryActor = "user" | "ai"

export type HistoryVerb = "added" | "removed" | "updated" | "created" | "deleted" | "renamed"

export interface HistoryEntry {
  verb: HistoryVerb
  entityKind: string
  entityId: string | null
  path: string
  timestamp: number
  actor: HistoryActor
  label: string
  color?: string
  newPath?: string
}

export type ContentDiffer = (
  oldRaw: string,
  newRaw: string,
  path: string,
  ts: number,
  actor: HistoryActor
) => HistoryEntry[]
