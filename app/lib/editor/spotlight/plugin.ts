import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"
import type { Node } from "prosemirror-model"
import type { Spotlight } from "./types"
import { exhaustive } from "~/lib/utils/exhaustive"
import { getBlockConfig } from "~/lib/data-blocks/registry"
import { findTextRange, proseTextContent, textOffsetToPos } from "~/lib/editor/text"
import type { TextRange } from "~/lib/editor/text"
import { findMatchOffset } from "~/lib/text/find"

const pluginKey = new PluginKey("spotlight")

export const spotlightMeta = pluginKey

const SPOTLIGHT_STYLE = "border-bottom: 2px solid var(--color-brand-600) !important;"

const resolveSpotlightSingle = (doc: Node, text: string): TextRange | null =>
  findTextRange(doc, text)

const resolveSpotlightRange = (doc: Node, from: string, to: string): TextRange | null => {
  const content = proseTextContent(doc)
  const fromOffset = findMatchOffset(content, from)
  if (!fromOffset) return null
  const remainingText = content.slice(fromOffset.start)
  const toOffset = findMatchOffset(remainingText, to)
  if (!toOffset) return null
  return {
    from: textOffsetToPos(doc, fromOffset.start),
    to: textOffsetToPos(doc, fromOffset.start + toOffset.end),
  }
}

const resolveSpotlight = (doc: Node, spotlight: Spotlight): TextRange | null => {
  switch (spotlight.type) {
    case "single":
      return resolveSpotlightSingle(doc, spotlight.text)
    case "range":
      return resolveSpotlightRange(doc, spotlight.from, spotlight.to)
    default:
      return exhaustive(spotlight)
  }
}

interface NodeSpan {
  nodePos: number
  nodeEnd: number
}

const isCalloutCodeBlock = (node: Node): boolean => {
  const config = getBlockConfig(node.attrs.language as string)
  return config?.renderer === "callout"
}

const findContainingCallout = (doc: Node, from: number, to: number): NodeSpan | null => {
  const $from = doc.resolve(from)
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (!isCalloutCodeBlock(node)) continue
    const nodePos = $from.before(depth)
    const nodeEnd = nodePos + node.nodeSize
    if (to <= nodeEnd) return { nodePos, nodeEnd }
    return null
  }
  return null
}

const toDecorationSet = (doc: Node, range: TextRange): DecorationSet => {
  const callout = findContainingCallout(doc, range.from, range.to)
  if (callout) {
    return DecorationSet.create(doc, [
      Decoration.node(callout.nodePos, callout.nodeEnd, { "data-spotlight": "true" }),
      Decoration.inline(range.from, range.to, {}, { spotlight: true }),
    ])
  }
  return DecorationSet.create(doc, [
    Decoration.inline(range.from, range.to, {
      style: SPOTLIGHT_STYLE,
      "data-spotlight": "true",
    }),
  ])
}

const computeDecorations = (doc: Node, spotlight: Spotlight | null): DecorationSet => {
  if (!spotlight) return DecorationSet.empty
  const range = resolveSpotlight(doc, spotlight)
  if (!range) return DecorationSet.empty
  return toDecorationSet(doc, range)
}

interface PluginState {
  spotlight: Spotlight | null
  decorations: DecorationSet
}

export const createSpotlightPlugin = (): Plugin =>
  new Plugin({
    key: pluginKey,
    state: {
      init: (): PluginState => ({ spotlight: null, decorations: DecorationSet.empty }),
      apply: (tr, pluginState, _oldState, newState) => {
        const newSpotlight = tr.getMeta(pluginKey) as Spotlight | null | undefined
        if (newSpotlight !== undefined) {
          return {
            spotlight: newSpotlight,
            decorations: computeDecorations(newState.doc, newSpotlight),
          }
        }
        if (!tr.docChanged) return pluginState
        return {
          spotlight: pluginState.spotlight,
          decorations: computeDecorations(newState.doc, pluginState.spotlight),
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
