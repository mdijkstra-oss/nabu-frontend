import { getEntityPrefixes } from "~/lib/data-blocks/registry"
import { ENTITY_ID_PARTIAL } from "~/lib/utils/entity-id"

export const filterCodeBlocks = (content: string): string | null => {
  const markers = content.match(/```/g)
  if (!markers) return content

  const isAllClosed = markers.length % 2 === 0
  if (isAllClosed) return content

  const lastMarkerIndex = content.lastIndexOf("```")
  const textBefore = content.slice(0, lastMarkerIndex).trim()
  return textBefore || null
}

const isCompleteLinkAt = (content: string, bracketIdx: number): boolean => {
  const after = content.slice(bracketIdx)
  return /^\[[^\]]*\]\([^)]*\)/.test(after)
}

export const stripIncompleteLink = (content: string): string => {
  const lastNewline = content.lastIndexOf("\n")
  const lastLine = content.slice(lastNewline + 1)
  const bracketIdx = lastLine.lastIndexOf("[")
  if (bracketIdx === -1) return content
  const absoluteIdx = lastNewline + 1 + bracketIdx
  if (isCompleteLinkAt(content, absoluteIdx)) return content
  const before = content.slice(0, absoluteIdx).trimEnd()
  return before
}

const PARTIAL_HIDDEN = /\.generated\S*$/

const buildPartialEntityPattern = (): RegExp => {
  const alt = getEntityPrefixes().join("|")
  return new RegExp(`(?:${alt})-${ENTITY_ID_PARTIAL}$`, "i")
}

export const stripPartialEntity = (content: string): string => {
  const lastNewline = content.lastIndexOf("\n")
  const lastLine = content.slice(lastNewline + 1)
  const lineOffset = lastNewline + 1

  const hiddenMatch = PARTIAL_HIDDEN.exec(lastLine)
  if (hiddenMatch) {
    const before = content.slice(0, lineOffset + hiddenMatch.index).trimEnd()
    return before
  }

  const pattern = buildPartialEntityPattern()
  const entityMatch = pattern.exec(lastLine)
  if (entityMatch) {
    const before = content.slice(0, lineOffset + entityMatch.index).trimEnd()
    return before
  }

  return content
}

export const preprocessStreaming = (content: string): string | null => {
  const afterCode = filterCodeBlocks(content)
  if (!afterCode) return null
  const afterLinks = stripIncompleteLink(afterCode)
  return stripPartialEntity(afterLinks) || null
}
