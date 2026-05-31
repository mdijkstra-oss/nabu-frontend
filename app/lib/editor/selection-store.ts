export interface EditorSelection {
  text: string
  from: number
  to: number
  filePath: string | null
  context: string | null
}

let selection: EditorSelection | null = null
let listeners: (() => void)[] = []

const notify = (): void => listeners.forEach((l) => l())

const isSameRange = (a: EditorSelection | null, b: EditorSelection | null): boolean => {
  if (a === b) return true
  if (!a || !b) return false
  return a.from === b.from && a.to === b.to
}

export const getEditorSelection = (): EditorSelection | null => selection

export const hasEditorSelection = (): boolean => selection !== null

export const setEditorSelection = (next: EditorSelection | null): void => {
  if (isSameRange(selection, next)) return
  selection = next
  notify()
}

export const clearEditorSelection = (): void => setEditorSelection(null)

export const subscribeEditorSelection = (listener: () => void): (() => void) => {
  listeners = [...listeners, listener]
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}
