import type { JsonPatchOp } from "~/lib/patch/structured-json/apply"
import { patchBlockContent } from "./patch"
import { stampActors } from "./actor"
import { getFileRaw, updateFileRaw } from "~/lib/files/store"

export interface FilePatch {
  path: string
  language: string
  ops: JsonPatchOp[]
  blockId?: string
  exactText?: boolean
}

export interface FileAction {
  patches: FilePatch[]
  immediate?: boolean
  skipPendingRefs?: boolean
}

export const executeUxAction = (patches: FilePatch[]): void =>
  executeFileAction({ patches, immediate: true, skipPendingRefs: true })

export const executeFileAction = (action: FileAction): void => {
  for (const patch of action.patches) {
    const original = getFileRaw(patch.path)
    const fuzzyOverride = patch.exactText ? [] : undefined
    const result = patchBlockContent(
      original,
      patch.language,
      patch.ops,
      patch.blockId,
      fuzzyOverride
    )
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
