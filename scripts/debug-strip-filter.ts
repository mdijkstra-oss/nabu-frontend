import { readFileSync } from "node:fs"
import { z } from "zod"
import { stripCodeBlockLines, remapRanges } from "~/lib/data-blocks/strip-lines"
import { chunkLines, CHUNK_TARGET_CHARS } from "~/lib/data-blocks/chunk-lines"
import { sortSegments, packComposites } from "~/lib/composite/pack"
import { mergeAndChunk, paragraphSeparator } from "~/lib/composite/merge"
import { processPool } from "~/lib/utils/pool"
import { errorMessage } from "~/lib/utils/error"
import {
  numberParagraphs,
  buildScoutFilterMessages,
  type NumberedParagraph,
} from "~/lib/agent/tools/scout-filter/messages"
import { ScoutFilterResponse } from "~/lib/agent/tools/scout-filter/def"
import { toResponseFormat } from "~/lib/agent/client/convert"

const LLM_HOST = process.env.VITE_LLM_HOST ?? "http://localhost:8081"
const CONNECT_TIMEOUT_MS = 30_000

const extractStreamText = async (response: Response): Promise<string> => {
  if (!response.body) throw new Error("No response body")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let text = ""
  let currentEvent = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7)
          continue
        }
        if (!line.startsWith("data: ")) continue
        if (currentEvent !== "response.output_text.delta") continue
        try {
          const parsed = JSON.parse(line.slice(6))
          if (parsed.delta) text += parsed.delta
        } catch {
          /* skip malformed lines */
        }
      }
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }

  return text
}

const callEndpoint = async (
  endpoint: string,
  messages: { type: "message"; role: string; content: string }[],
  responseFormat?: ReturnType<typeof toResponseFormat>
): Promise<string> => {
  const body: Record<string, unknown> = { messages }
  if (responseFormat) body.response_format = responseFormat

  const response = await fetch(`${LLM_HOST}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
  })

  if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`)

  return extractStreamText(response)
}

const SectionLabelResponse = z.object({
  label: z.string(),
  desc: z.string(),
})

interface SectionLabel {
  label: string
  desc: string
}

const labelSection = async (text: string): Promise<SectionLabel> => {
  const raw = await callEndpoint(
    "/section-labeler",
    [{ type: "message", role: "user", content: `${text}\n\nLabel this section.` }],
    toResponseFormat(SectionLabelResponse)
  )
  const parsed = SectionLabelResponse.safeParse(JSON.parse(raw))
  if (!parsed.success) throw new Error(`Invalid labeler response: ${parsed.error.message}`)
  return parsed.data
}

const expandRanges = (ranges: ScoutFilterResponse["exclude"]): Set<number> => {
  const set = new Set<number>()
  for (const { from, to } of ranges) {
    for (let i = from; i <= to; i++) set.add(i)
  }
  return set
}

interface FilterResult {
  surviving: NumberedParagraph[]
  excludedIndices: Set<number>
}

const filterTarget = async (framework: string, content: string): Promise<FilterResult> => {
  const paragraphs = numberParagraphs(content)
  if (paragraphs.length === 0) return { surviving: [], excludedIndices: new Set() }

  const messages = buildScoutFilterMessages(framework, paragraphs)
  const raw = await callEndpoint(
    "/scout-filter",
    messages,
    toResponseFormat(ScoutFilterResponse)
  )
  const parsed = ScoutFilterResponse.safeParse(JSON.parse(raw))
  if (!parsed.success) throw new Error(`scout-filter parse failed: ${parsed.error.message}`)

  const excludedIndices = expandRanges(parsed.data.exclude)
  const surviving = paragraphs.filter((p) => !excludedIndices.has(p.index))

  const summary = parsed.data.exclude
    .map((r) => `  [${r.from}-${r.to}] ${r.reason}`)
    .join("\n")
  console.log(`[scout-filter] ${excludedIndices.size}/${paragraphs.length} excluded\n${summary}`)

  return { surviving, excludedIndices }
}

const USAGE = "Usage: tsx scripts/debug-strip-filter.ts <target-file> [framework-file]"

const targetPath = process.argv[2]
if (!targetPath) {
  console.error(USAGE)
  process.exit(1)
}

const frameworkPath = process.argv[3]

const readFileOrDie = (path: string): string => {
  try {
    return readFileSync(path, "utf-8")
  } catch {
    console.error(`Cannot read: ${path}`)
    process.exit(1)
  }
}

interface LabeledTarget {
  path: string
  label: string
  desc?: string
  ranges: { startLine: number; endLine: number }[]
}

const run = async (): Promise<void> => {
  const content = readFileOrDie(targetPath)
  const framework = frameworkPath ? readFileOrDie(frameworkPath) : ""

  const originalLineCount = content.split("\n").length
  console.log(`--- Input: ${targetPath} (${originalLineCount} lines)`)
  if (frameworkPath) console.log(`--- Framework: ${frameworkPath}`)
  console.log(`--- LLM host: ${LLM_HOST}`)

  const { content: stripped, lineMap } = stripCodeBlockLines(content)
  const strippedLineCount = stripped.split("\n").length
  console.log(
    `--- Stripped: ${strippedLineCount} lines (removed ${originalLineCount - strippedLineCount} code block lines)`
  )

  const { surviving, excludedIndices } = await filterTarget(framework, stripped)
  console.log(
    `--- Filter: ${surviving.length} surviving, ${excludedIndices.size} excluded`
  )

  if (surviving.length === 0) {
    console.log(`--- No surviving paragraphs. Done.`)
    return
  }

  const chunks = chunkLines(stripped, CHUNK_TARGET_CHARS)
  const segments = mergeAndChunk(surviving, targetPath, CHUNK_TARGET_CHARS, chunks)
  const sorted = sortSegments(segments)
  const composites = packComposites(sorted, CHUNK_TARGET_CHARS, paragraphSeparator)

  console.log(`--- ${composites.length} composite(s) to label`)

  const indexed = composites.map((composite, index) => ({ index, composite }))

  const { results, failures } = await processPool(
    indexed,
    async ({ index, composite }) => {
      const label = await labelSection(composite.content)
      const rawRanges = composite.segments.map((s) => ({
        startLine: s.startLine,
        endLine: s.endLine,
      }))
      const ranges = remapRanges(lineMap, rawRanges)
      const target: LabeledTarget = {
        path: targetPath,
        label: label.label,
        desc: label.desc,
        ranges,
      }
      return [{ index, target }]
    },
    () => undefined,
    { concurrency: 10, warmup: 1 }
  )

  if (failures.length > 0) {
    console.error(`--- ${failures.length} labeling failure(s):`)
    for (const f of failures) console.error(`  ${errorMessage(f.error)}`)
  }

  const targets = (results as { index: number; target: LabeledTarget }[])
    .sort((a, b) => a.index - b.index)
    .map((r) => r.target)

  console.log(`\n--- Results (${targets.length} labeled targets):`)
  console.log(JSON.stringify(targets, null, 2))
}

run().catch((e) => {
  console.error(`Fatal: ${errorMessage(e)}`)
  process.exit(1)
})
