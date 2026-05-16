import type { ScoutMap, ScoutSection } from "../scout-map"
import { parseCodeBlocks, type CodeBlock } from "~/lib/data-blocks/parse"
import { isSingleton } from "~/lib/data-blocks/registry"
import { resolveBlockLabel } from "~/lib/data-blocks/registry"
import { parseBlockJson } from "~/lib/data-blocks/parse"

const blockTypeName = (language: string): string =>
  language.startsWith("json-") ? language.slice(5) : language

const formatEmbeddedMarker = (block: CodeBlock): string => {
  const type = blockTypeName(block.language)
  const parsed = parseBlockJson<Record<string, unknown>>(block)
  const label = parsed.ok ? resolveBlockLabel(block.language, parsed.data) : null
  return label ? `[embedded ${type}: "${label}"]` : `[embedded ${type}]`
}

const isWithinAny = (blocks: CodeBlock[], lineStart: number, lineEnd: number): boolean =>
  blocks.some((b) => b.start <= lineStart && lineEnd <= b.end)

const findBlockOpeningAt = (blocks: CodeBlock[], lineStart: number): CodeBlock | undefined =>
  blocks.find((b) => b.start === lineStart)

export const presentContent = (content: string): string => {
  const blocks = parseCodeBlocks(content)
  const lines = content.split("\n")
  const outputLines: string[] = []
  let offset = 0

  for (const line of lines) {
    const lineStart = offset
    const lineEnd = offset + line.length

    const openingBlock = findBlockOpeningAt(blocks, lineStart)
    if (openingBlock) {
      if (!isSingleton(openingBlock.language)) {
        outputLines.push(formatEmbeddedMarker(openingBlock))
      }
    } else if (!isWithinAny(blocks, lineStart, lineEnd)) {
      outputLines.push(line)
    }

    offset = lineEnd + 1
  }

  return outputLines.join("\n")
}

export const extractLines = (content: string, startLine: number, endLine: number): string =>
  content
    .split("\n")
    .slice(startLine - 1, endLine)
    .join("\n")

export const formatSection = (section: ScoutSection): string => {
  const header = `[${section.start_line}-${section.end_line}] ${section.label}`
  const desc = section.desc ? `  ${section.desc}` : null
  return [header, desc].filter((l): l is string => l !== null).join("\n")
}

export const formatScoutMap = (path: string, map: ScoutMap): string => {
  const header = `File: ${path}`
  const body = map.sections.map(formatSection).join("\n\n")
  return `${header}\n\n${body}`
}
