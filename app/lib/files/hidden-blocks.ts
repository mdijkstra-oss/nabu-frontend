import { parseCodeBlocks, parseBlockJson, replaceBlock } from "~/lib/data-blocks/parse"
import { findFileForId } from "./pending-refs"
import { getFilesStripped, getFileRaw } from "./store"

const GENERATED_SUFFIX = ".generated.hidden.md"

const parseHiddenId = (path: string): string | null =>
  path.endsWith(GENERATED_SUFFIX) ? path.slice(0, -GENERATED_SUFFIX.length) : null

export const resolveHiddenFile = (path: string): string | undefined => {
  const id = parseHiddenId(path)
  if (!id) return undefined

  const filename = findFileForId(id)
  if (!filename) return undefined

  const content = getFilesStripped()[filename]
  if (!content) return undefined

  for (const block of parseCodeBlocks(content)) {
    const parsed = parseBlockJson(block)
    if (!parsed.ok) continue
    const data = parsed.data as Record<string, unknown>
    if (data.id === id)
      return "```" + block.language + "\n" + JSON.stringify(data, null, 2) + "\n```"
  }

  return undefined
}

export const resolveGeneratedWrite = (
  path: string,
  newBlockContent: string
): { realPath: string; realContent: string } | undefined => {
  const id = parseHiddenId(path)
  if (!id) return undefined

  const realPath = findFileForId(id)
  if (!realPath) return undefined

  const content = getFileRaw(realPath)
  if (!content) return undefined

  for (const block of parseCodeBlocks(content)) {
    const parsed = parseBlockJson(block)
    if (!parsed.ok) continue
    const data = parsed.data as Record<string, unknown>
    if (data.id === id)
      return { realPath, realContent: replaceBlock(content, block, newBlockContent) }
  }

  return undefined
}
