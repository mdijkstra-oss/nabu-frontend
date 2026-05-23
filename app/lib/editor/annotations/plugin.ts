import { Plugin, PluginKey } from "prosemirror-state"
import { DecorationSet } from "prosemirror-view"
import type { Node } from "prosemirror-model"
import { hasReview, type Annotation } from "~/domain/data-blocks/attributes/annotations/selectors"
import type { ResolvedAnnotation } from "./types"
import { segmentByOverlap } from "./overlap"
import { createDecorationSet, createMarkerDecorations } from "./decorations"
import { findTextRange, proseTextContent } from "~/lib/editor/text"

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

interface PluginState {
  annotations: Annotation[]
  decorations: DecorationSet
}

const computeDecorations = (doc: Node, annotations: Annotation[]): DecorationSet => {
  const resolved = resolveAnnotations(doc, annotations)
  const segments = segmentByOverlap(resolved)
  const markers = createMarkerDecorations(resolved)
  return createDecorationSet(doc, segments, markers)
}

export const createAnnotationsPlugin = (): Plugin =>
  new Plugin({
    key: pluginKey,
    state: {
      init: (): PluginState => ({ annotations: [], decorations: DecorationSet.empty }),
      apply: (tr, pluginState, _oldState, newState) => {
        const newAnnotations = tr.getMeta(pluginKey) as Annotation[] | undefined
        if (newAnnotations !== undefined) {
          return {
            annotations: newAnnotations,
            decorations: computeDecorations(newState.doc, newAnnotations),
          }
        }
        if (!tr.docChanged) return pluginState
        return {
          annotations: pluginState.annotations,
          decorations: computeDecorations(newState.doc, pluginState.annotations),
        }
      },
    },
    props: {
      decorations: (state) => {
        const ps = pluginKey.getState(state) as PluginState | undefined
        return ps?.decorations ?? DecorationSet.empty
      },
    },
  })
