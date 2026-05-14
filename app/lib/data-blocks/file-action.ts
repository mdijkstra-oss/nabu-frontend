import type { JsonPatchOp } from "~/lib/patch/structured-json/apply"
import { patchBlockContent } from "./patch"
import { stampActors } from "./actor"
import { getFileRaw, updateFileRaw } from "~/lib/files/store"

export interface FilePatch {
  path: string
  language: string
  ops: JsonPatchOp[]
  blockId?: string
}

export interface FileAction {
  patches: FilePatch[]
  immediate?: boolean
  skipPendingRefs?: boolean
}

export const executeFileAction = (action: FileAction): void => {
  for (const patch of action.patches) {
    const original = getFileRaw(patch.path)
    const result = patchBlockContent(original, patch.language, patch.ops, patch.blockId)
    if (!result.ok) {
      console.error(
        `[FILE-ACTION] patch failed for ${patch.path} (${patch.language}):`,
        result.error
      )
      continue
    }

    const stamped = stampActors(original, result.content, "user")
    updateFileRaw(patch.path, stamped, {
      immediate: action.immediate,
      skipPendingRefs: action.skipPendingRefs,
    })
  }
}
