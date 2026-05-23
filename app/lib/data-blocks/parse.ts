import { getByPath } from "./json"
import { errorMessage } from "~/lib/utils/error"
import { createCappedCache } from "~/lib/utils/cache"

export interface CodeBlock {
  language: string
  content: string
  start: number
  end: number
}

const CODE_BLOCK_REGEX = /```(\S+)[ \t]*\r?\n([\s\S]*?)```/g

const blockCache = createCappedCache<string, CodeBlock[]>(1000)

export const parseCodeBlocks = (markdown: string): CodeBlock[] => {
  const cached = blockCache.get(markdown)
  if (cached) return cached
  const blocks = parseCodeBlocksUncached(markdown)
  blockCache.set(markdown, blocks)
  return blocks
}

const parseCodeBlocksUncached = (markdown: string): CodeBlock[] => {
  const blocks: CodeBlock[] = []
  let match: RegExpExecArray | null

  while ((match = CODE_BLOCK_REGEX.exec(markdown)) !== null) {
    blocks.push({
      language: match[1],
      content: match[2].trim(),
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return blocks
}

export const findBlocksByLanguage = (markdown: string, language: string): CodeBlock[] =>
  parseCodeBlocks(markdown).filter((b) => b.language === language)

export const findSingletonBlock = (markdown: string, language: string): CodeBlock | undefined =>
  findBlocksByLanguage(markdown, language)[0]

type ParseJsonResult<T> = { ok: true; data: T } | { ok: false; error: string; raw: string }

const snippet = (s: string, max = 200): string => (s.length <= max ? s : s.slice(0, max) + "…")

export const parseBlockJson = <T>(block: CodeBlock): ParseJsonResult<T> => {
  try {
    return { ok: true, data: JSON.parse(block.content) as T }
  } catch (e) {
    return { ok: false, error: errorMessage(e), raw: snippet(block.content) }
  }
}

interface BlockIdRecord {
  id: string
  [key: string]: unknown
}

const hasId = (data: unknown): data is BlockIdRecord =>
  typeof data === "object" &&
  data !== null &&
  "id" in data &&
  typeof (data as Record<string, unknown>).id === "string"

interface BlockWithData<T = unknown> {
  block: CodeBlock
  data: T
}

export const findBlockById = (
  markdown: string,
  language: string,
  id: string
): BlockWithData | undefined => {
  const blocks = findBlocksByLanguage(markdown, language)
  for (const block of blocks) {
    const parsed = parseBlockJson(block)
    if (parsed.ok && hasId(parsed.data) && parsed.data.id === id) {
      return { block, data: parsed.data }
    }
  }
  return undefined
}

interface BlockSummary {
  id: string
  label: string | undefined
}

export const summarizeBlocks = (
  markdown: string,
  language: string,
  labelKey: string | undefined
): BlockSummary[] =>
  findBlocksByLanguage(markdown, language).reduce<BlockSummary[]>((acc, block) => {
    const parsed = parseBlockJson(block)
    if (!parsed.ok || !hasId(parsed.data)) return acc
    const rawLabel = labelKey
      ? getByPath(parsed.data as Record<string, unknown>, labelKey)
      : undefined
    const label = typeof rawLabel === "string" ? rawLabel : undefined
    return [...acc, { id: parsed.data.id, label }]
  }, [])

export const isLineInsideBlock = (
  blocks: CodeBlock[],
  lineStart: number,
  lineEnd: number
): boolean => blocks.some((b) => b.start <= lineStart && lineEnd <= b.end)

export const formatBlock = (language: string, content: string): string =>
  `\`\`\`${language}\n${content}\n\`\`\``

export const replaceBlock = (markdown: string, block: CodeBlock, newContent: string): string =>
  markdown.slice(0, block.start) +
  formatBlock(block.language, newContent) +
  markdown.slice(block.end)

export const replaceSingletonBlock = (
  markdown: string,
  language: string,
  newContent: string
): string => {
  const block = findSingletonBlock(markdown, language)
  if (block) return replaceBlock(markdown, block, newContent)
  return markdown.trimEnd() + "\n\n" + formatBlock(language, newContent)
}

export const replaceBlockContents = (
  markdown: string,
  updates: { block: CodeBlock; newContent: string }[]
): string => {
  let result = markdown
  let offset = 0

  for (const { block, newContent } of updates) {
    const blockStart = block.start + offset
    const blockEnd = block.end + offset
    const section = result.slice(blockStart, blockEnd)
    const replaced = section.replace(block.content, () => newContent)

    result = result.slice(0, blockStart) + replaced + result.slice(blockEnd)
    offset += replaced.length - section.length
  }

  return result
}

export const collapseBlankLines = (text: string): string => text.replace(/\n{3,}/g, "\n\n")

export const stripBlock = (markdown: string, block: CodeBlock): string =>
  collapseBlankLines(markdown.slice(0, block.start) + markdown.slice(block.end))

export const stripBlocksByLanguage = (raw: string, language: string): string => {
  const blocks = findBlocksByLanguage(raw, language)
  if (blocks.length === 0) return raw.trim()
  let result = raw
  for (let i = blocks.length - 1; i >= 0; i--) {
    result = result.slice(0, blocks[i].start) + result.slice(blocks[i].end)
  }
  return collapseBlankLines(result).trim()
}

export type ToDeepSourceFn = (parsed: unknown) => string | null

const tryConvertBlock = (
  language: string,
  content: string,
  converters: Record<string, ToDeepSourceFn>
): string | null => {
  const fn = converters[language]
  if (!fn) return null
  try {
    return fn(JSON.parse(content))
  } catch {
    return null
  }
}

export const toDeepSourceContent = (
  markdown: string,
  converters: Record<string, ToDeepSourceFn>
): string => {
  const blocks = parseCodeBlocks(markdown)
  let result = markdown

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    const converted = tryConvertBlock(block.language, block.content, converters)
    const replacement = converted ?? ""
    result = result.slice(0, block.start) + replacement + result.slice(block.end)
  }

  return collapseBlankLines(result).trim()
}

export const extractProse = (markdown: string): string => {
  const blocks = parseCodeBlocks(markdown)
  let prose = markdown

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    prose = prose.slice(0, block.start) + prose.slice(block.end)
  }

  return prose
}

const FENCE = "```"

const isWhitespaceOnly = (s: string): boolean => s.trim().length === 0

export const ensureFencesOnOwnLines = (markdown: string): string => {
  const lines = markdown.split("\n")
  const result: string[] = []

  for (const line of lines) {
    const fenceIdx = line.indexOf(FENCE)
    if (fenceIdx === -1) {
      result.push(line)
      continue
    }

    const before = line.slice(0, fenceIdx)
    const fenceAndAfter = line.slice(fenceIdx)

    if (isWhitespaceOnly(before)) {
      result.push(fenceAndAfter)
    } else {
      result.push(before.trimEnd())
      result.push(fenceAndAfter)
    }
  }

  return result.join("\n")
}
