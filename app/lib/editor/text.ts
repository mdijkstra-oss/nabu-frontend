import type { Node } from "prosemirror-model"
import { isHiddenRenderer } from "~/lib/data-blocks/registry"
import { findMatchOffset } from "~/lib/text/find"

export interface TextRange {
  from: number
  to: number
}

type NodeFilter = (node: Node) => boolean

const isHiddenCodeBlock = (node: Node): boolean =>
  node.type.name === "code_block" && isHiddenRenderer(node.attrs.language as string)

const collectText = (doc: Node, shouldSkip: NodeFilter): string => {
  let text = ""
  doc.descendants((node) => {
    if (shouldSkip(node)) return false
    if (node.isBlock && text.length > 0 && !text.endsWith("\n")) text += "\n"
    if (node.isLeaf && node.textContent.length > 0) text += node.textContent
    return !node.isLeaf
  })
  return text
}

export const proseTextContent = (doc: Node): string => collectText(doc, isHiddenCodeBlock)

const offsetToPos = (doc: Node, offset: number, shouldSkip: NodeFilter): number => {
  let result = 0
  let textSeen = 0
  let found = false
  let lastNodeEnd = 0
  let needsSep = false

  doc.descendants((node, nodePos) => {
    if (found) return false
    if (shouldSkip(node)) return false

    if (node.isBlock && needsSep) {
      if (textSeen === offset) {
        result = lastNodeEnd
        found = true
        return false
      }
      textSeen += 1
      needsSep = false
    }

    if (textSeen > offset) return false

    const len = node.textContent.length

    if (len > 0 && node.isLeaf) {
      needsSep = true
      lastNodeEnd = nodePos + node.nodeSize
      if (textSeen + len > offset) {
        result = nodePos + (offset - textSeen)
        found = true
        return false
      }
      textSeen += len
    }

    return !node.isLeaf
  })

  if (!found && offset === textSeen) {
    return lastNodeEnd
  }

  return result
}

export const textOffsetToPos = (doc: Node, offset: number): number =>
  offsetToPos(doc, offset, isHiddenCodeBlock)

const posToOffset = (doc: Node, targetPos: number, shouldSkip: NodeFilter): number => {
  let textSeen = 0
  let needsSep = false

  doc.descendants((node, nodePos) => {
    if (nodePos >= targetPos) return false
    if (shouldSkip(node)) return false

    if (node.isBlock && needsSep) {
      textSeen += 1
      needsSep = false
    }

    const len = node.textContent.length
    if (len > 0 && node.isLeaf) {
      needsSep = true
      const nodeEnd = nodePos + node.nodeSize
      if (targetPos <= nodeEnd) {
        textSeen += targetPos - nodePos
        return false
      }
      textSeen += len
    }

    return !node.isLeaf
  })

  return textSeen
}

export const posToTextOffset = (doc: Node, pos: number): number =>
  posToOffset(doc, pos, isHiddenCodeBlock)

export const findTextRange = (doc: Node, needle: string, cachedText?: string): TextRange | null => {
  const content = cachedText ?? proseTextContent(doc)
  const offset = findMatchOffset(content, needle)
  if (!offset) return null
  return { from: textOffsetToPos(doc, offset.start), to: textOffsetToPos(doc, offset.end) }
}
