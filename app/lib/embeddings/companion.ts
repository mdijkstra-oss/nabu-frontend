import type { EmbeddingEntry } from "./diff"
import { findBlocksByLanguage } from "~/lib/data-blocks/parse"

const COMPANION_SUFFIX = ".embeddings.hidden.md"
const MD_EXTENSION = ".md"
const LANGUAGE = "json-embeddings"

export const companionFilename = (source: string): string =>
  source.replace(/\.md$/, COMPANION_SUFFIX)

export const sourceFilename = (companion: string): string =>
  companion.replace(/\.embeddings\.hidden\.md$/, MD_EXTENSION)

export const isCompanionFile = (filename: string): boolean => filename.endsWith(COMPANION_SUFFIX)

const entryToBlock = (entry: EmbeddingEntry): string =>
  `\`\`\`${LANGUAGE}\n${JSON.stringify(entry)}\n\`\`\``

export const buildCompanionMarkdown = (entries: EmbeddingEntry[]): string =>
  entries.map(entryToBlock).join("\n\n")

const isValidEntry = (parsed: Record<string, unknown>): boolean =>
  typeof parsed.hash === "string" &&
  typeof parsed.text === "string" &&
  Array.isArray(parsed.embedding) &&
  typeof parsed.chunkStart === "number" &&
  typeof parsed.chunkEnd === "number"

const parseEntry = (content: string): EmbeddingEntry | null => {
  try {
    const parsed = JSON.parse(content)
    if (!isValidEntry(parsed)) return null
    return parsed as EmbeddingEntry
  } catch {
    return null
  }
}

// WHY not getBlocks() from query.ts: this runs once per sync, so there is nothing to
// memoise. Its cache keys the block's own text, and a 1024-float vector serialises to
// ~20KB per entry, which would crowd out the small blocks (settings, callouts) read on
// every render.
export const parseCompanionEntries = (markdown: string): EmbeddingEntry[] =>
  findBlocksByLanguage(markdown, LANGUAGE)
    .map((block) => parseEntry(block.content))
    .filter((e): e is EmbeddingEntry => e !== null)

const FENCE_OPEN = `\`\`\`${LANGUAGE}\n`
const FENCE_CLOSE = "\n```"

export const fastParseBlockContents = (markdown: string): string[] => {
  const blocks: string[] = []
  let pos = 0
  while (pos < markdown.length) {
    const openIdx = markdown.indexOf(FENCE_OPEN, pos)
    if (openIdx === -1) break
    const contentStart = openIdx + FENCE_OPEN.length
    const closeIdx = markdown.indexOf(FENCE_CLOSE, contentStart)
    if (closeIdx === -1) break
    blocks.push(markdown.slice(contentStart, closeIdx))
    pos = closeIdx + FENCE_CLOSE.length
  }
  return blocks
}
