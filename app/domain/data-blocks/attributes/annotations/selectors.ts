import type { Annotation as StoredAnnotation } from "../schema"
import { findCodeById } from "~/domain/data-blocks/callout/codes/selectors"
import { getBlock } from "~/lib/data-blocks/query"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import type { FileStore } from "~/lib/files/store"
import { findIn, findFileFor } from "~/lib/files/collect"
import { wilsonUpperBound } from "~/lib/utils/wilson"

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
  vote: stored.vote,
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

export const hasReview = (a: Annotation): boolean => a.vote?.review !== undefined

const hasStoredReview = (a: StoredAnnotation): boolean => a.vote?.review !== undefined

export type ReviewSeverity = "normal" | "warning" | "danger"

export interface ReviewStat {
  ratio: number
  severity: ReviewSeverity
}

const collectReviewTallies = (
  files: FileStore
): { totals: Record<string, number>; reviewed: Record<string, number> } => {
  const totals: Record<string, number> = {}
  const reviewed: Record<string, number> = {}
  for (const raw of Object.values(files)) {
    for (const a of getStoredAnnotations(raw)) {
      if (!a.code) continue
      totals[a.code] = (totals[a.code] ?? 0) + 1
      if (hasStoredReview(a)) reviewed[a.code] = (reviewed[a.code] ?? 0) + 1
    }
  }
  return { totals, reviewed }
}

const isReviewOutlier = (
  code: string,
  totals: Record<string, number>,
  reviewed: Record<string, number>
): boolean => {
  const codeTotal = totals[code] ?? 0
  const codeReviewed = reviewed[code] ?? 0
  if (codeTotal === 0) return false

  const otherTotal = Object.entries(totals).reduce((sum, [k, v]) => sum + (k === code ? 0 : v), 0)
  const otherReviewed = Object.entries(reviewed).reduce(
    (sum, [k, v]) => sum + (k === code ? 0 : v),
    0
  )

  const baselineUpper = wilsonUpperBound(otherReviewed, otherTotal)
  const codeRatio = codeReviewed / codeTotal
  const above = codeRatio > baselineUpper

  console.debug(
    `[wilson] ${code}: total=${codeTotal} reviewed=${codeReviewed} ratio=${codeRatio.toFixed(2)} wilson=${baselineUpper.toFixed(3)} self=${codeRatio.toFixed(3)} above=${above}`
  )

  return above
}

const LOW_CONFIDENCE_THRESHOLD = 5

const toSeverity = (outlier: boolean, total: number): ReviewSeverity => {
  if (!outlier) return "normal"
  return total < LOW_CONFIDENCE_THRESHOLD ? "warning" : "danger"
}

export const getReviewStatsByCode = (files: FileStore): Record<string, ReviewStat> => {
  const { totals, reviewed } = collectReviewTallies(files)
  const result: Record<string, ReviewStat> = {}
  for (const code of Object.keys(reviewed)) {
    const ratio = Math.round((reviewed[code] / totals[code]) * 100) / 100
    const outlier = isReviewOutlier(code, totals, reviewed)
    result[code] = { ratio, severity: toSeverity(outlier, totals[code]) }
  }
  return result
}
