import { Plugin, PluginKey } from "prosemirror-state"
import type { EditorState } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { Decoration, DecorationSet } from "prosemirror-view"
import { setEditorSelection, clearEditorSelection } from "~/lib/editor/selection-store"
import { proseTextContent, posToTextOffset } from "~/lib/editor/text"
import { expandWithContext } from "~/lib/text/find"

const pluginKey = new PluginKey("editorSelection")

const INACTIVE_SELECTION_CLASS = "ProseMirror-inactive-selection"

interface SelectionPluginState {
  focused: boolean
  decorations: DecorationSet
}

const isEmptySelection = (from: number, to: number): boolean => from === to

const createBlurDecorations = (state: EditorState): DecorationSet => {
  const { from, to } = state.selection
  if (isEmptySelection(from, to)) return DecorationSet.empty
  return DecorationSet.create(state.doc, [
    Decoration.inline(from, to, { class: INACTIVE_SELECTION_CLASS }),
  ])
}

const CONTEXT_PAD_WORDS = 8

const buildContext = (view: EditorView, from: number, to: number): string | null => {
  const doc = view.state.doc
  const proseText = proseTextContent(doc)
  const selStart = posToTextOffset(doc, from)
  const selEnd = posToTextOffset(doc, to)
  return expandWithContext(proseText, selStart, selEnd, CONTEXT_PAD_WORDS)
}

const syncSelection = (view: EditorView, filePath: string | null): void => {
  const { from, to } = view.state.selection
  if (isEmptySelection(from, to)) {
    clearEditorSelection()
    return
  }
  const text = view.state.doc.textBetween(from, to, "\n")
  const context = buildContext(view, from, to)
  setEditorSelection({ text, from, to, filePath, context })
}

export const createSelectionPlugin = (filePath: string | null): Plugin =>
  new Plugin({
    key: pluginKey,
    state: {
      init: (): SelectionPluginState => ({
        focused: true,
        decorations: DecorationSet.empty,
      }),
      apply: (tr, pluginState, oldState, newState): SelectionPluginState => {
        const meta = tr.getMeta(pluginKey) as { focused: boolean } | undefined
        if (meta !== undefined) {
          if (meta.focused) return { focused: true, decorations: DecorationSet.empty }
          return { focused: false, decorations: createBlurDecorations(newState) }
        }
        if (pluginState.focused) return pluginState
        if (tr.docChanged || !newState.selection.eq(oldState.selection)) {
          return { focused: false, decorations: createBlurDecorations(newState) }
        }
        return pluginState
      },
    },
    props: {
      decorations: (state): DecorationSet => {
        const ps = pluginKey.getState(state) as SelectionPluginState | undefined
        return ps?.decorations ?? DecorationSet.empty
      },
      handleDOMEvents: {
        blur: (view) => {
          view.dispatch(view.state.tr.setMeta(pluginKey, { focused: false }))
          return false
        },
        focus: (view) => {
          view.dispatch(view.state.tr.setMeta(pluginKey, { focused: true }))
          return false
        },
      },
    },
    view: () => ({
      update: (view, prevState) => {
        const selChanged =
          !view.state.selection.eq(prevState.selection) || view.state.doc !== prevState.doc
        if (selChanged) syncSelection(view, filePath)
      },
      destroy: () => {
        clearEditorSelection()
      },
    }),
  })
