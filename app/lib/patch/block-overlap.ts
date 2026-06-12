import { parseCodeBlocks, parseBlockJson, type CodeBlock } from "~/lib/data-blocks/parse"
import { isKnownBlockType, isSingleton } from "~/lib/data-blocks/registry"

export interface BlockOverlap {
  language: string
  shortName: string
  blockId?: string
}

const stripJsonPrefix = (language: string): string =>
  language.startsWith("json-") ? language.slice(5) : language

const hasStringId = (data: unknown): data is { id: string } =>
  typeof data === "object" &&
  data !== null &&
  "id" in data &&
  typeof (data as Record<string, unknown>).id === "string"

const toOverlap = (block: CodeBlock): BlockOverlap => {
  const parsed = parseBlockJson(block)
  return {
    language: block.language,
    shortName: stripJsonPrefix(block.language),
    blockId: parsed.ok && hasStringId(parsed.data) ? parsed.data.id : undefined,
  }
}

const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && aEnd > bStart

export const findBlockOverlap = (
  content: string,
  spanStart: number,
  spanEnd: number
): BlockOverlap | null => {
  for (const block of parseCodeBlocks(content)) {
    if (!isKnownBlockType(block.language)) continue
    if (rangesOverlap(spanStart, spanEnd, block.start, block.end)) return toOverlap(block)
  }
  return null
}

const maskRange = (text: string, start: number, end: number): string => {
  const head = text.slice(0, start)
  const tail = text.slice(end)
  const region = text.slice(start, end).replace(/[^\n]/g, " ")
  return head + region + tail
}

export const maskKnownBlocks = (content: string): string => {
  let result = content
  for (const block of parseCodeBlocks(content)) {
    if (!isKnownBlockType(block.language)) continue
    result = maskRange(result, block.start, block.end)
  }
  return result
}

const FENCE_PREFIX = "```"

const extractFenceLanguage = (line: string): string | null => {
  const trimmed = line.trim()
  if (!trimmed.startsWith(FENCE_PREFIX)) return null
  const lang = trimmed.slice(FENCE_PREFIX.length).trim()
  return lang && isKnownBlockType(lang) ? lang : null
}

export const findFenceCreations = (text: string): string[] => {
  const seen = new Set<string>()
  for (const line of text.split("\n")) {
    const lang = extractFenceLanguage(line)
    if (lang && !seen.has(lang)) seen.add(lang)
  }
  return [...seen]
}

export const formatBlockOverlap = (o: BlockOverlap): string => {
  const blockRef = o.blockId ? ` "${o.blockId}"` : ""
  const targetRef = o.blockId ? ` to block "${o.blockId}"` : ""
  return `\`${o.language}\` block${blockRef} is read-only for this tool. Use \`patch_${o.shortName}\` or \`delete_${o.shortName}\` for targeted changes${targetRef}.`
}

export const formatFenceCreation = (language: string): string => {
  const shortName = stripJsonPrefix(language)
  const createTool = isSingleton(language)
    ? `\`patch_${shortName}\``
    : `\`add_${shortName}\` to place the block, then \`patch_${shortName}\``
  return `Cannot create \`${language}\` block with this tool. Use ${createTool} to populate it.`
}

export const formatFenceCreations = (languages: string[]): string =>
  languages.map(formatFenceCreation).join("\n")
