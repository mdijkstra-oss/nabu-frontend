import type { HistoryEntry, HistoryActor, ContentDiffer } from "./types"
import { toDisplayName } from "~/lib/files/filename"
import { diffAnnotations } from "./differs/annotations"
import { diffCodes } from "./differs/codes"
import { diffTags } from "./differs/tags"
import { diffProse } from "./differs/prose"

const contentDiffers: ContentDiffer[] = [diffAnnotations, diffCodes, diffTags, diffProse]

export const diffFileContent: ContentDiffer = (oldRaw, newRaw, path, ts, actor) =>
  contentDiffers.flatMap((d) => d(oldRaw, newRaw, path, ts, actor))

export const fileCreatedEntry = (path: string, ts: number, actor: HistoryActor): HistoryEntry => ({
  verb: "created",
  entityKind: "file",
  entityId: null,
  path,
  timestamp: ts,
  actor,
  label: toDisplayName(path),
})

export const fileDeletedEntry = (path: string, ts: number, actor: HistoryActor): HistoryEntry => ({
  verb: "deleted",
  entityKind: "file",
  entityId: null,
  path,
  timestamp: ts,
  actor,
  label: toDisplayName(path),
})

export const fileRenamedEntry = (
  path: string,
  newPath: string,
  ts: number,
  actor: HistoryActor
): HistoryEntry => ({
  verb: "renamed",
  entityKind: "file",
  entityId: null,
  path,
  timestamp: ts,
  actor,
  label: toDisplayName(path),
  newPath,
})
