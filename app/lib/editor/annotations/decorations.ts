import { Decoration, DecorationSet } from "prosemirror-view"
import type { Node } from "prosemirror-model"
import type { OverlapSegment, ResolvedAnnotation } from "./types"
import { createBackground } from "./gradient"

const toRadixVar = (color: string): string => `var(--${color}-3)`

const toBackgroundColors = (colors: string[]): string[] => colors.map(toRadixVar)

const createDecorationAttrs = (segment: OverlapSegment) => {
  const bgColors = toBackgroundColors(segment.colors)
  return {
    style: `background: ${createBackground(bgColors)}; border-radius: 2px;`,
    "data-annotation-colors": segment.colors.join(","),
  }
}

const hasId = (a: ResolvedAnnotation): a is ResolvedAnnotation & { id: string } =>
  a.id !== undefined

const toMarkerDecoration = (a: ResolvedAnnotation & { id: string }): Decoration =>
  Decoration.inline(a.from, a.to, { "data-id": a.id })

const REVIEW_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`

const createReviewWidget = (color: string): HTMLElement => {
  const span = document.createElement("span")
  span.innerHTML = REVIEW_ICON_SVG
  span.style.background = toRadixVar(color)
  span.style.borderRadius = "2px"
  span.style.padding = "0 2px"
  span.style.display = "inline-flex"
  span.style.alignItems = "center"
  span.style.verticalAlign = "baseline"
  span.style.color = "var(--amber-11)"
  span.setAttribute("aria-label", "Flagged for review")
  return span
}

const hasReviewFlag = (a: ResolvedAnnotation): boolean => a.review === true

const toReviewDecoration = (a: ResolvedAnnotation): Decoration =>
  Decoration.widget(a.from, () => createReviewWidget(a.color), { side: -1 })

export const createMarkerDecorations = (resolved: ResolvedAnnotation[]): Decoration[] => [
  ...resolved.filter(hasId).map(toMarkerDecoration),
  ...resolved.filter(hasReviewFlag).map(toReviewDecoration),
]

export const createDecorationSet = (
  doc: Node,
  segments: OverlapSegment[],
  markerDecorations: Decoration[] = []
): DecorationSet => {
  const overlapDecorations = segments.map((segment) =>
    Decoration.inline(segment.from, segment.to, createDecorationAttrs(segment))
  )
  return DecorationSet.create(doc, [...overlapDecorations, ...markerDecorations])
}
