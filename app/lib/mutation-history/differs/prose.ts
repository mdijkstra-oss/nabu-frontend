import { extractProse } from "~/lib/data-blocks/parse"
import type { ContentDiffer } from "../types"

export const diffProse: ContentDiffer = (oldRaw, newRaw, path, ts, actor) => {
  const oldProse = extractProse(oldRaw).trim()
  const newProse = extractProse(newRaw).trim()
  if (oldProse === newProse) return []
  return [
    {
      verb: "updated",
      entityKind: "text",
      entityId: null,
      path,
      timestamp: ts,
      actor,
      label: path,
    },
  ]
}
