import type { FilePatch } from "~/lib/data-blocks/file-action"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"

const isClearable = (a: Annotation, codeIds: Set<string>): boolean =>
  !!a.id && !!a.code && codeIds.has(a.code) && !a.locked

export const clearCodingsPatches = (
  path: string,
  codeIds: Set<string>,
  annotations: readonly Annotation[]
): FilePatch[] => {
  const ops = annotations
    .filter((a) => isClearable(a, codeIds))
    .map((a) => ({ op: "remove" as const, path: `/annotations[id=${a.id}]` }))
  if (ops.length === 0) return []
  return [{ path, language: "json-annotations", ops }]
}
