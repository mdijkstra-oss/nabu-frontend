import type { Annotation as StoredAnnotation } from "../schema"
import { findCodeById } from "~/domain/data-blocks/callout/codes/selectors"
import { getBlock } from "~/lib/data-blocks/query"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import type { FileStore } from "~/lib/files/store"
import { findIn, findFileFor, createFileStoreSelector } from "~/lib/files/collect"
import { wilsonUpperBound, wilsonLowerBound } from "~/lib/utils/wilson"

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
  locked: stored.locked,
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

interface PerFileAnnotationCounts {
  countByCode: Map<string, number>
}

const extractPerFileAnnotationCounts = (raw: string): PerFileAnnotationCounts => {
  const countByCode = new Map<string, number>()
  for (const a of getStoredAnnotations(raw)) {
    if (!a.code) continue
    countByCode.set(a.code, (countByCode.get(a.code) ?? 0) + 1)
  }
  return { countByCode }
}

export const getAnnotationGlobalCountsByCode = createFileStoreSelector<
  PerFileAnnotationCounts,
  Record<string, GlobalAnnotationCount>
>({
  extract: extractPerFileAnnotationCounts,
  initial: () => ({}),
  fold: (acc, partial) => {
    for (const [code, count] of partial.countByCode) {
      acc[code] = acc[code] ?? { count: 0, fileCount: 0 }
      acc[code].count += count
      acc[code].fileCount += 1
    }
  },
})

export const isLocked = (a: { locked?: boolean }): boolean => a.locked === true

export const hasReview = (a: Annotation): boolean => a.vote?.review !== undefined

const hasStoredReview = (a: StoredAnnotation): boolean => a.vote?.review !== undefined

export type ReviewSeverity = "normal" | "warning" | "danger"

export interface ReviewStat {
  ratio: number
  severity: ReviewSeverity
}

interface PerFileReviewTallies {
  totals: Map<string, number>
  reviewed: Map<string, number>
}

const extractPerFileReviewTallies = (raw: string): PerFileReviewTallies => {
  const totals = new Map<string, number>()
  const reviewed = new Map<string, number>()
  for (const a of getStoredAnnotations(raw)) {
    if (!a.code || !a.vote) continue
    totals.set(a.code, (totals.get(a.code) ?? 0) + 1)
    if (hasStoredReview(a)) reviewed.set(a.code, (reviewed.get(a.code) ?? 0) + 1)
  }
  return { totals, reviewed }
}

const collectReviewTallies = createFileStoreSelector<
  PerFileReviewTallies,
  { totals: Record<string, number>; reviewed: Record<string, number> }
>({
  extract: extractPerFileReviewTallies,
  initial: () => ({ totals: {}, reviewed: {} }),
  fold: (acc, partial) => {
    for (const [code, count] of partial.totals) {
      acc.totals[code] = (acc.totals[code] ?? 0) + count
    }
    for (const [code, count] of partial.reviewed) {
      acc.reviewed[code] = (acc.reviewed[code] ?? 0) + count
    }
  },
})

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
  const codeLower = wilsonLowerBound(codeReviewed, codeTotal)
  const above = codeLower > baselineUpper

  console.debug(
    `[wilson] ${code}: total=${codeTotal} reviewed=${codeReviewed} lower=${codeLower.toFixed(3)} baseline=${baselineUpper.toFixed(3)} above=${above}`
  )

  return above
}

const LOW_CONFIDENCE_THRESHOLD = 5

const toSeverity = (outlier: boolean, total: number): ReviewSeverity => {
  if (!outlier) return "normal"
  return total < LOW_CONFIDENCE_THRESHOLD ? "warning" : "danger"
}

const extractPerFileReviewedCounts = (raw: string): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const a of getStoredAnnotations(raw)) {
    if (!a.code || !hasStoredReview(a)) continue
    counts.set(a.code, (counts.get(a.code) ?? 0) + 1)
  }
  return counts
}

export const getReviewedCountsByCode = createFileStoreSelector<
  Map<string, number>,
  Record<string, number>
>({
  extract: extractPerFileReviewedCounts,
  initial: () => ({}),
  fold: (acc, partial) => {
    for (const [code, count] of partial) {
      acc[code] = (acc[code] ?? 0) + count
    }
  },
})

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
