import { PluginKey, type Plugin } from "prosemirror-state"
import type { DecorationSet } from "prosemirror-view"
import type { Node } from "prosemirror-model"
import { hasReview, type Annotation } from "~/domain/data-blocks/attributes/annotations/selectors"
import type { ResolvedAnnotation } from "./types"
import { segmentByOverlap } from "./overlap"
import { createDecorationSet, createMarkerDecorations } from "./decorations"
import { findTextRange, proseTextContent } from "~/lib/editor/text"
import { createDecorationPlugin, replaceInput } from "~/lib/editor/decoration-plugin"

const pluginKey = new PluginKey("annotations")

export const annotationsMeta = pluginKey

const toResolvedAnnotation = (
  a: Annotation,
  doc: Node,
  docText: string,
  index: number
): ResolvedAnnotation | null => {
  const range = findTextRange(doc, a.text, docText)
  if (!range) return null
  const resolved: ResolvedAnnotation = {
    index,
    from: range.from,
    to: range.to,
    color: a.color,
  }
  if (a.id) resolved.id = a.id
  if (a.locked) resolved.locked = true
  if (hasReview(a)) resolved.review = true
  return resolved
}

const resolveAnnotations = (doc: Node, annotations: Annotation[]): ResolvedAnnotation[] => {
  const docText = proseTextContent(doc)
  let index = 0
  return annotations.flatMap((a) => {
    const resolved = toResolvedAnnotation(a, doc, docText, index)
    index++
    return resolved ? [resolved] : []
  })
}

const computeDecorations = (doc: Node, annotations: Annotation[]): DecorationSet => {
  const resolved = resolveAnnotations(doc, annotations)
  const segments = segmentByOverlap(resolved)
  const markers = createMarkerDecorations(resolved)
  return createDecorationSet(doc, segments, markers)
}

export const createAnnotationsPlugin = (): Plugin =>
  createDecorationPlugin<Annotation[], Annotation[]>({
    key: pluginKey,
    initial: [],
    reduce: replaceInput,
    compute: computeDecorations,
  })
