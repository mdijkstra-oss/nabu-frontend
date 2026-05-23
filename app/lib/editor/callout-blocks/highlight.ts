import { findMatchOffset } from "~/lib/text/find"

interface TextNode {
  node: Text
  startInFull: number
}

const collectTextNodes = (container: HTMLElement): { nodes: TextNode[]; fullText: string } => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: TextNode[] = []
  let fullText = ""
  let current = walker.nextNode()
  while (current) {
    nodes.push({ node: current as Text, startInFull: fullText.length })
    fullText += current.textContent ?? ""
    current = walker.nextNode()
  }
  return { nodes, fullText }
}

const toRanges = (nodes: TextNode[], from: number, to: number): Range[] => {
  const ranges: Range[] = []

  for (const { node, startInFull } of nodes) {
    const nodeLen = node.textContent?.length ?? 0
    const nodeEnd = startInFull + nodeLen
    if (nodeEnd <= from || startInFull >= to) continue

    const clampStart = Math.max(from, startInFull) - startInFull
    const clampEnd = Math.min(to, nodeEnd) - startInFull
    const range = document.createRange()
    range.setStart(node, clampStart)
    range.setEnd(node, clampEnd)
    ranges.push(range)
  }

  return ranges
}

const findTextRangesInDOM = (container: HTMLElement, text: string): Range[] => {
  const { nodes, fullText } = collectTextNodes(container)
  const offset = findMatchOffset(fullText, text)
  if (!offset) return []
  return toRanges(nodes, offset.start, offset.end)
}

const supportsHighlightAPI = (): boolean => typeof CSS !== "undefined" && "highlights" in CSS

const highlightCSS = (name: string, css: string): HTMLStyleElement => {
  const style = document.createElement("style")
  style.textContent = `::highlight(${name}) { ${css} }`
  document.head.appendChild(style)
  return style
}

export interface HighlightEntry {
  text: string
  isSpotlight: boolean
}

export const applyDOMHighlights = (
  container: HTMLElement,
  id: string,
  entries: HighlightEntry[]
): (() => void) => {
  if (!supportsHighlightAPI() || entries.length === 0) return () => undefined

  const spotlightTexts = entries.filter((e) => e.isSpotlight).map((e) => e.text)
  const annotationTexts = entries.filter((e) => !e.isSpotlight).map((e) => e.text)

  const cleanups: (() => void)[] = []

  const applyGroup = (texts: string[], suffix: string, css: string) => {
    const ranges = texts.flatMap((t) => findTextRangesInDOM(container, t))
    if (ranges.length === 0) return
    const name = `ch-${suffix}-${id}`
    CSS.highlights.set(name, new Highlight(...ranges))
    const style = highlightCSS(name, css)
    cleanups.push(() => {
      CSS.highlights.delete(name)
      style.remove()
    })
  }

  applyGroup(spotlightTexts, "s", "text-decoration: underline 2px var(--color-brand-600);")
  applyGroup(annotationTexts, "a", "background-color: var(--amber-3);")

  return () => cleanups.forEach((fn) => fn())
}
