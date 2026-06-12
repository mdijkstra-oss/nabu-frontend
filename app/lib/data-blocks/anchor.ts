import { resolveAnchor, isAnchorError } from "~/lib/text/anchor"
import { maskKnownBlocks } from "~/lib/patch/block-overlap"
import { findBlockById, stripBlock } from "./parse"
import { generateShortId } from "./uuid"

export type AnchorResult<T> = ({ ok: true } & T) | { ok: false; error: string }

type InsertResult = AnchorResult<{ content: string; generatedId: string }>
type MoveResult = AnchorResult<{ content: string }>

const endOfLineAt = (content: string, charOffset: number): number => {
  const eol = content.indexOf("\n", charOffset)
  return eol === -1 ? content.length : eol
}

const formatNotFound = (content: string, error: string): string => {
  const lineCount = content.split("\n").length
  return `${error} in document (${lineCount} lines). Provide more specific context.`
}

const formatNewBlock = (language: string, generatedId: string): string =>
  `\n\n\`\`\`${language}\n{"id":"${generatedId}"}\n\`\`\`\n`

interface ResolvedInsertion {
  ok: true
  insertAt: number
}
type Resolution = ResolvedInsertion | { ok: false; error: string }

const resolveInsertionPoint = (content: string, anchorContext: string): Resolution => {
  const span = resolveAnchor(maskKnownBlocks(content), anchorContext)
  if (isAnchorError(span)) return { ok: false, error: formatNotFound(content, span.error) }

  const insertAt = endOfLineAt(content, span.end)
  return { ok: true, insertAt }
}

export const insertBlockAtAnchor = (
  content: string,
  language: string,
  anchorContext: string,
  idPrefix: string
): InsertResult => {
  const resolved = resolveInsertionPoint(content, anchorContext)
  if (!resolved.ok) return resolved

  const generatedId = `${idPrefix}-${generateShortId()}`
  const newContent =
    content.slice(0, resolved.insertAt) +
    formatNewBlock(language, generatedId) +
    content.slice(resolved.insertAt)

  return { ok: true, content: newContent, generatedId }
}

const insertBlockText = (target: string, blockText: string, insertAt: number): string =>
  target.slice(0, insertAt) + "\n\n" + blockText + "\n" + target.slice(insertAt)

export const moveBlockToAnchor = (
  content: string,
  language: string,
  blockId: string,
  anchorContext: string
): MoveResult => {
  const found = findBlockById(content, language, blockId)
  if (!found) return { ok: false, error: `No \`${language}\` block with id "${blockId}"` }

  const stripped = stripBlock(content, found.block)
  const resolved = resolveInsertionPoint(stripped, anchorContext)
  if (!resolved.ok) return resolved

  const blockText = content.slice(found.block.start, found.block.end)
  return { ok: true, content: insertBlockText(stripped, blockText, resolved.insertAt) }
}

type CrossFileMoveResult = AnchorResult<{ sourceContent: string; targetContent: string }>

export const moveBlockToTargetFile = (
  sourceContent: string,
  targetContent: string,
  language: string,
  blockId: string,
  anchorContext: string
): CrossFileMoveResult => {
  const found = findBlockById(sourceContent, language, blockId)
  if (!found) return { ok: false, error: `No \`${language}\` block with id "${blockId}"` }

  if (findBlockById(targetContent, language, blockId))
    return {
      ok: false,
      error: `target file already contains \`${language}\` block "${blockId}"`,
    }

  const resolved = resolveInsertionPoint(targetContent, anchorContext)
  if (!resolved.ok) return resolved

  const blockText = sourceContent.slice(found.block.start, found.block.end)
  const strippedSource = stripBlock(sourceContent, found.block)
  const newTarget = insertBlockText(targetContent, blockText, resolved.insertAt)

  return { ok: true, sourceContent: strippedSource, targetContent: newTarget }
}
