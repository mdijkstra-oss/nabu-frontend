import { useSyncExternalStore } from "react"
import {
  getEditorSelection,
  hasEditorSelection,
  subscribeEditorSelection,
} from "~/lib/editor/selection-store"
import type { EditorSelection } from "~/lib/editor/selection-store"

export const useEditorSelection = (): EditorSelection | null =>
  useSyncExternalStore(subscribeEditorSelection, getEditorSelection, getEditorSelection)

export const useHasEditorSelection = (): boolean =>
  useSyncExternalStore(subscribeEditorSelection, hasEditorSelection, hasEditorSelection)
