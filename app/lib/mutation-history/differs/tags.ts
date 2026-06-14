import { getTags } from "~/domain/data-blocks/attributes/tags/selectors"
import type { HistoryEntry, HistoryActor, ContentDiffer } from "../types"

const toTagEntry = (
  verb: "added" | "removed",
  tag: string,
  path: string,
  ts: number,
  actor: HistoryActor
): HistoryEntry => ({
  verb,
  entityKind: "tag",
  entityId: null,
  path,
  timestamp: ts,
  actor,
  label: tag,
})

export const diffTags: ContentDiffer = (oldRaw, newRaw, path, ts, actor) => {
  const oldSet = new Set(getTags(oldRaw))
  const newSet = new Set(getTags(newRaw))

  const removed = [...oldSet]
    .filter((t) => !newSet.has(t))
    .map((t) => toTagEntry("removed", t, path, ts, actor))
  const added = [...newSet]
    .filter((t) => !oldSet.has(t))
    .map((t) => toTagEntry("added", t, path, ts, actor))

  return [...removed, ...added]
}
