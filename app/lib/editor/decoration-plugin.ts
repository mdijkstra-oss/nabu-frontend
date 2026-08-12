import { Plugin, type EditorState, type PluginKey } from "prosemirror-state"
import { DecorationSet, type EditorProps } from "prosemirror-view"
import type { Node } from "prosemirror-model"

interface DecorationPluginState<Input> {
  input: Input
  decorations: DecorationSet
}

export interface DecorationPluginSpec<Input, Message> {
  key: PluginKey
  initial: Input
  reduce: (input: Input, message: Message) => Input
  compute: (doc: Node, input: Input) => DecorationSet
  props?: Omit<EditorProps<Plugin<DecorationPluginState<Input>>>, "decorations">
}

export const replaceInput = <T>(_input: T, message: T): T => message

export const getPluginInput = <Input>(key: PluginKey, state: EditorState): Input | undefined =>
  (key.getState(state) as DecorationPluginState<Input> | undefined)?.input

export const createDecorationPlugin = <Input, Message>({
  key,
  initial,
  reduce,
  compute,
  props,
}: DecorationPluginSpec<Input, Message>): Plugin =>
  new Plugin<DecorationPluginState<Input>>({
    key,
    state: {
      init: () => ({ input: initial, decorations: DecorationSet.empty }),
      apply: (tr, pluginState, _oldState, newState) => {
        const message = tr.getMeta(key) as Message | undefined
        if (message !== undefined) {
          const input = reduce(pluginState.input, message)
          return { input, decorations: compute(newState.doc, input) }
        }
        if (!tr.docChanged) return pluginState
        return {
          input: pluginState.input,
          decorations: compute(newState.doc, pluginState.input),
        }
      },
    },
    props: {
      ...props,
      decorations: (state) => key.getState(state)?.decorations ?? DecorationSet.empty,
    },
  })
