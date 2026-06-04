import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { chunkLines, CHUNK_TARGET_CHARS } from "~/lib/data-blocks/chunk-lines"
import { parseCodeBlocks, parseBlockJson, isLineInsideBlock, type CodeBlock } from "~/lib/data-blocks/parse"
import { splitBySentences } from "~/lib/text/split"
import { formatNumberedPassage } from "~/lib/text/format"

const SINGLETONS = new Set(["json-attributes", "json-settings"])
const LABEL_KEYS: Record<string, string> = { "json-chart": "title", "json-callout": "title" }

const blockTypeName = (language: string): string =>
  language.startsWith("json-") ? language.slice(5) : language

const resolveLabel = (block: CodeBlock): string | null => {
  const key = LABEL_KEYS[block.language]
  if (!key) return null
  const parsed = parseBlockJson<Record<string, unknown>>(block)
  if (!parsed.ok) return null
  const val = parsed.data[key]
  return typeof val === "string" ? val : null
}

const formatMarker = (block: CodeBlock): string => {
  const type = blockTypeName(block.language)
  const label = resolveLabel(block)
  return label ? `[embedded ${type}: "${label}"]` : `[embedded ${type}]`
}

const findBlockAt = (blocks: CodeBlock[], lineStart: number): CodeBlock | undefined =>
  blocks.find((b) => b.start === lineStart)

const presentContent = (content: string): string => {
  const blocks = parseCodeBlocks(content)
  const lines = content.split("\n")
  const out: string[] = []
  let offset = 0

  for (const line of lines) {
    const lineStart = offset
    const lineEnd = offset + line.length

    const opening = findBlockAt(blocks, lineStart)
    if (opening) {
      if (!SINGLETONS.has(opening.language)) {
        out.push(formatMarker(opening))
      }
    } else if (!isLineInsideBlock(blocks, lineStart, lineEnd)) {
      out.push(line)
    }

    offset = lineEnd + 1
  }

  return out.join("\n")
}

const extractLines = (content: string, startLine: number, endLine: number): string =>
  content.split("\n").slice(startLine - 1, endLine).join("\n")

const splitSentences = splitBySentences()
const numberSection = (text: string): { sentences: string[]; numbered: string } => {
  const sentences = splitSentences(text).map((s) => s.text)
  return { sentences, numbered: formatNumberedPassage(text) }
}

const inputPath = process.argv[2]
if (!inputPath) {
  console.error("Usage: tsx scripts/debug-scout-chunks.ts <file>")
  process.exit(1)
}

const outDir = `${process.env.HOME}/Desktop/scout-chunks`
mkdirSync(outDir, { recursive: true })

const content = readFileSync(inputPath, "utf-8")

const chunks = chunkLines(content, CHUNK_TARGET_CHARS)

for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i]
  const slice = extractLines(content, chunk.startLine, chunk.endLine)
  const presented = presentContent(slice)
  const { sentences, numbered } = numberSection(slice)

  const scoutHeader = [
    `# Chunk ${i + 1} of ${chunks.length} — SCOUT VIEW`,
    `# Lines ${chunk.startLine}-${chunk.endLine}`,
    `# Size: ${presented.length} chars (~${Math.round(presented.length / 4)} tokens)`,
    "",
  ].join("\n")

  const analysisHeader = [
    `# Chunk ${i + 1} of ${chunks.length} — ANALYSIS VIEW (${sentences.length} sentences)`,
    `# Lines ${chunk.startLine}-${chunk.endLine}`,
    `# Size: ${numbered.length} chars (~${Math.round(numbered.length / 4)} tokens)`,
    "",
  ].join("\n")

  const pad = String(i + 1).padStart(2, "0")
  writeFileSync(`${outDir}/${pad}-scout-L${chunk.startLine}-L${chunk.endLine}.txt`, scoutHeader + presented)
  writeFileSync(`${outDir}/${pad}-analysis-L${chunk.startLine}-L${chunk.endLine}.txt`, analysisHeader + numbered)
}

const summary = [
  `${chunks.length} chunks from ${content.split("\n").length} lines (target: ${CHUNK_TARGET_CHARS} chars)`,
  "",
  ...chunks.map((c, i) => {
    const slice = extractLines(content, c.startLine, c.endLine)
    const presented = presentContent(slice)
    const { sentences } = numberSection(slice)
    return `Chunk ${i + 1}: L${c.startLine}-L${c.endLine} | scout: ${presented.length} chars | analysis: ${sentences.length} sentences`
  }),
  "",
].join("\n")

writeFileSync(`${outDir}/00-summary.txt`, summary)

console.log(`${chunks.length} chunks written to ${outDir}`)
