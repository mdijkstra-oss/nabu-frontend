import type { JsonPatchOp } from "~/lib/patch/structured-json/apply"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import { findMatchOffset, type MatchOffset } from "~/lib/text/find"

export interface SelectionRange {
  start: number
  end: number
}

export interface AnnotationPatchResult {
  ops: JsonPatchOp[]
}

interface ResolvedStoredAnnotation {
  annotation: Annotation
  offset: MatchOffset
}

const rangesOverlap = (a: SelectionRange, b: MatchOffset): boolean =>
  a.start < b.end && b.start < a.end

const findOverlappingAnnotation = (
  selection: SelectionRange,
  resolved: ResolvedStoredAnnotation[]
): ResolvedStoredAnnotation | null => {
  for (const r of resolved) {
    if (rangesOverlap(selection, r.offset)) return r
  }
  return null
}

const resolveAnnotationOffsets = (
  annotations: Annotation[],
  docText: string
): ResolvedStoredAnnotation[] =>
  annotations.flatMap((annotation) => {
    const offset = findMatchOffset(docText, annotation.text)
    if (!offset) return []
    return [{ annotation, offset }]
  })

const buildAddOp = (value: Record<string, unknown>): JsonPatchOp => ({
  op: "add",
  path: "/annotations/-",
  value,
})

const buildRemoveOp = (id: string): JsonPatchOp => ({
  op: "remove",
  path: `/annotations[id=${id}]`,
})

export const buildAnnotationPatchOps = (
  selection: SelectionRange,
  docText: string,
  annotationsForCode: Annotation[],
  codeId: string,
  newId: string
): AnnotationPatchResult => {
  const resolved = resolveAnnotationOffsets(annotationsForCode, docText)
  const overlapping = findOverlappingAnnotation(selection, resolved)

  if (!overlapping) {
    const text = docText.slice(selection.start, selection.end)
    return {
      ops: [buildAddOp({ id: newId, text, reason: "", code: codeId, actor: "user" })],
    }
  }

  const existing = overlapping.annotation
  const unionStart = Math.min(selection.start, overlapping.offset.start)
  const unionEnd = Math.max(selection.end, overlapping.offset.end)
  const mergedText = docText.slice(unionStart, unionEnd)

  const merged: Record<string, unknown> = {
    id: newId,
    text: mergedText,
    reason: existing.reason,
    code: codeId,
    actor: "user",
  }
  if (existing.vote?.review !== undefined) {
    merged.vote = { ...existing.vote }
  }

  const ops: JsonPatchOp[] = []
  if (existing.id) ops.push(buildRemoveOp(existing.id))
  ops.push(buildAddOp(merged))

  return { ops }
}
