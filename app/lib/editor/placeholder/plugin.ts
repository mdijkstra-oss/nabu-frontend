import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"
import type { Node } from "prosemirror-model"
import { pickPlaceholderLine } from "./lines"

const pluginKey = new PluginKey("placeholder")

const emptyParagraph = (doc: Node): Node | null =>
  doc.childCount === 1 &&
  doc.firstChild !== null &&
  doc.firstChild.type.name === "paragraph" &&
  doc.firstChild.content.size === 0
    ? doc.firstChild
    : null

export const createPlaceholderPlugin = (): Plugin => {
  const line = pickPlaceholderLine()
  return new Plugin({
    key: pluginKey,
    props: {
      decorations: (state) => {
        const paragraph = emptyParagraph(state.doc)
        if (!paragraph) return DecorationSet.empty
        return DecorationSet.create(state.doc, [
          Decoration.node(0, paragraph.nodeSize, {
            class: "is-editor-empty",
            "data-placeholder": line,
          }),
        ])
      },
    },
  })
}
