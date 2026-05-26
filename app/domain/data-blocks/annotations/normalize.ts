interface AnnotationEntry {
  id?: string
  code?: string
  vote?: { find: { found: number; missed: number }; review?: string }
}

interface AnnotationsDoc {
  annotations: AnnotationEntry[]
}

const isAnnotationsDoc = (doc: unknown): doc is AnnotationsDoc =>
  typeof doc === "object" &&
  doc !== null &&
  "annotations" in doc &&
  Array.isArray((doc as AnnotationsDoc).annotations)

const buildCodeIndex = (annotations: AnnotationEntry[]): Map<string, string | undefined> => {
  const index = new Map<string, string | undefined>()
  for (const a of annotations) {
    if (a.id) index.set(a.id, a.code)
  }
  return index
}

const hasCodeChanged = (oldCode: string | undefined, newCode: string | undefined): boolean =>
  oldCode !== newCode

const clearStaleReview = (
  annotation: AnnotationEntry,
  oldCodes: Map<string, string | undefined>
): AnnotationEntry => {
  if (!annotation.id) return annotation
  if (!annotation.vote?.review) return annotation

  const oldCode = oldCodes.get(annotation.id)
  if (oldCode === undefined && !oldCodes.has(annotation.id)) return annotation
  if (!hasCodeChanged(oldCode, annotation.code)) return annotation

  const { review: _, ...restVote } = annotation.vote
  return { ...annotation, vote: restVote }
}

export const normalizeAnnotations = (oldDoc: unknown, newDoc: unknown): unknown => {
  if (!isAnnotationsDoc(oldDoc) || !isAnnotationsDoc(newDoc)) return newDoc

  const oldCodes = buildCodeIndex(oldDoc.annotations)
  const normalized = newDoc.annotations.map((a) => clearStaleReview(a, oldCodes))

  const hasChanges = normalized.some((a, i) => a !== newDoc.annotations[i])
  if (!hasChanges) return newDoc

  return { ...newDoc, annotations: normalized }
}
