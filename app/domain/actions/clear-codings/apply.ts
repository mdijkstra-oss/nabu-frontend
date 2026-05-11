import type { FileAction } from "~/lib/data-blocks/file-action"

export const clearCodingsAction = (path: string, codeIds: Set<string>): FileAction => ({
  patches: [
    {
      path,
      language: "json-annotations",
      ops: [...codeIds].map((id) => ({ op: "remove" as const, path: `/annotations[code=${id}]` })),
    },
  ],
  immediate: true,
  skipPendingRefs: true,
})
