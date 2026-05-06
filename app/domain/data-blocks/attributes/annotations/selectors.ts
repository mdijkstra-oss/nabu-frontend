import type { Annotation as StoredAnnotation } from "../schema"
import { findCodeById } from "~/domain/data-blocks/callout/codes/selectors"
import { getBlock } from "~/lib/data-blocks/query"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import type { FileStore } from "~/lib/files/store"
import { findIn, findFileFor } from "~/lib/files/collect"

export type Annotation = Omit<StoredAnnotation, "color"> & { color: string }

export const getStoredAnnotations = (raw: string): StoredAnnotation[] =>
  getBlock(raw, "json-annotations", AnnotationsBlockSchema)?.annotations ?? []

export const getAnnotationCount = (raw: string): number => getStoredAnnotations(raw).length

const DEFAULT_ANNOTATION_COLOR = "gray"

export const resolveAnnotationColor = (files: FileStore, annotation: StoredAnnotation): string => {
  if (annotation.color) return annotation.color
  if (annotation.code)
    return findCodeById(files, annotation.code)?.color ?? DEFAULT_ANNOTATION_COLOR
  return DEFAULT_ANNOTATION_COLOR
}

const resolveAnnotation = (files: FileStore, stored: StoredAnnotation): Annotation => ({
  id: stored.id,
  text: stored.text,
  color: resolveAnnotationColor(files, stored),
  reason: stored.reason,
  code: stored.code,
})

export const getAnnotations = (files: FileStore, raw: string): Annotation[] =>
  getStoredAnnotations(raw).map((a) => resolveAnnotation(files, a))

const hasId = (id: string) => (a: StoredAnnotation) => a.id === id

export const findAnnotationById = (files: FileStore, id: string): StoredAnnotation | undefined =>
  findIn(files, getStoredAnnotations, hasId(id))

export const findDocumentForAnnotation = (files: FileStore, id: string): string | undefined =>
  findFileFor(files, getStoredAnnotations, hasId(id))

export const getAnnotationCountsByCode = (annotations: Annotation[]): Record<string, number> =>
  annotations.reduce<Record<string, number>>((acc, a) => {
    if (a.code) acc[a.code] = (acc[a.code] ?? 0) + 1
    return acc
  }, {})

export interface GlobalAnnotationCount {
  count: number
  fileCount: number
}

export const getAnnotationGlobalCountsByCode = (
  files: FileStore
): Record<string, GlobalAnnotationCount> => {
  const result: Record<string, GlobalAnnotationCount> = {}
  for (const raw of Object.values(files)) {
    const codesInFile = new Set<string>()
    for (const a of getStoredAnnotations(raw)) {
      if (!a.code) continue
      result[a.code] = result[a.code] ?? { count: 0, fileCount: 0 }
      result[a.code].count += 1
      codesInFile.add(a.code)
    }
    codesInFile.forEach((code) => {
      result[code].fileCount += 1
    })
  }
  return result
}
