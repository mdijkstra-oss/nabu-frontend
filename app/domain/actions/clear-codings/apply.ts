import type { FilePatch } from "~/lib/data-blocks/file-action"

export const clearCodingsPatches = (path: string, codeIds: Set<string>): FilePatch[] => [
  {
    path,
    language: "json-annotations",
    ops: [...codeIds].map((id) => ({ op: "remove" as const, path: `/annotations[code=${id}]` })),
  },
]
