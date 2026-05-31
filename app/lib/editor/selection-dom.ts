export interface EditorSelectionSlice {
  filePath: string
  selectedText: string
  context: string
}

const EDITOR_SELECTOR = "[data-file-path]"

const intersectRange = (range: Range, container: Element): Range => {
  const clipped = document.createRange()
  clipped.selectNodeContents(container)
  if (range.compareBoundaryPoints(Range.START_TO_START, clipped) > 0) {
    clipped.setStart(range.startContainer, range.startOffset)
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, clipped) < 0) {
    clipped.setEnd(range.endContainer, range.endOffset)
  }
  return clipped
}

const extractSlice = (range: Range, container: Element): EditorSelectionSlice | null => {
  const filePath = container.getAttribute("data-file-path")
  if (!filePath) return null
  const selectedText = intersectRange(range, container).toString()
  if (!selectedText.trim()) return null
  return { filePath, selectedText, context: container.textContent ?? "" }
}

export const extractEditorSelections = (): EditorSelectionSlice[] => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return []
  const range = sel.getRangeAt(0)
  const containers = document.querySelectorAll(EDITOR_SELECTOR)
  const slices: EditorSelectionSlice[] = []
  for (const container of containers) {
    if (!range.intersectsNode(container)) continue
    const slice = extractSlice(range, container)
    if (slice) slices.push(slice)
  }
  return slices
}
