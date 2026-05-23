import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import mri from "mri"
import { extractProse } from "~/lib/data-blocks/parse"
import { stripMarkdown } from "~/lib/text/strip"
import { splitBySentences } from "~/lib/text/split"
import { compareRuns, formatComparison } from "./kappa"
import type { SectionResult } from "./types"
import type { AnalysisResult } from "~/lib/agent/tools/apply-deep-analysis/format"
import type { Segment } from "~/lib/text/types"

interface MdAnnotation {
  text: string
  reason: string
  code: string
  vote?: { find: { found: number; missed: number }; review?: string }
}

const extractAnnotations = (markdown: string): MdAnnotation[] => {
  const match = markdown.match(/```json-annotations\n([\s\S]*?)\n```/)
  if (match === null) return []
  const parsed = JSON.parse(match[1]) as { annotations: MdAnnotation[] }
  return parsed.annotations
}

const prepareText = (markdown: string): string =>
  stripMarkdown(extractProse(markdown), { keepHeadings: true })

const splitSentencesFn = splitBySentences()

const mapNormalizedToOriginal = (prose: string, normalizedIdx: number): number => {
  let origIdx = 0
  let normIdx = 0
  while (normIdx < normalizedIdx && origIdx < prose.length) {
    if (/\s/.test(prose[origIdx])) {
      origIdx++
      while (origIdx < prose.length && /\s/.test(prose[origIdx])) origIdx++
      normIdx++
    } else {
      origIdx++
      normIdx++
    }
  }
  return origIdx
}

const findSentenceRange = (
  prose: string,
  segments: Segment[],
  annotationText: string
): { start: number; end: number } | null => {
  const needle = annotationText.replace(/\s+/g, " ").trim()
  if (needle.length === 0) return null

  const normalizedProse = prose.replace(/\s+/g, " ")
  const charIdx = normalizedProse.indexOf(needle)
  if (charIdx === -1) return null

  const origStart = mapNormalizedToOriginal(prose, charIdx)
  const origEnd = mapNormalizedToOriginal(prose, charIdx + needle.length)

  let startSent = -1
  let endSent = -1

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].end > origStart && startSent === -1) startSent = i
    if (segments[i].start < origEnd) endSent = i
  }

  if (startSent === -1 || endSent === -1) return null
  return { start: startSent + 1, end: endSent + 1 }
}

const mdToSectionResult = (
  markdown: string,
  prose: string,
  segments: Segment[]
): SectionResult => {
  const annotations = extractAnnotations(markdown)
  const results: AnalysisResult[] = []

  for (const ann of annotations) {
    const range = findSentenceRange(prose, segments, ann.text)
    if (range === null) {
      console.warn(`[compare-md] could not locate: "${ann.text.slice(0, 60)}..."`)
      continue
    }
    results.push({
      start: range.start,
      end: range.end,
      analysis_source_id: ann.code,
      reason: ann.reason,
      vote: ann.vote,
    })
  }

  return {
    startLine: 1,
    endLine: 1,
    sentenceCount: segments.length,
    results,
  }
}

const main = () => {
  const args = mri(process.argv.slice(2), {
    string: ["out"],
  })

  const files = (args._ as string[]).map((f) => resolve(f))

  if (files.length < 2) {
    console.error("Usage: npx tsx scripts/bench/compare-md.ts <file1.md> <file2.md> [file3.md ...]")
    console.error("  Compares annotations across MD files that share the same source text.")
    process.exit(1)
  }

  const markdowns = files.map((f) => readFileSync(f, "utf-8"))

  const referenceText = prepareText(markdowns[0])
  const segments = splitSentencesFn(referenceText)

  console.log(`=== MD Annotation Comparison ===\n`)
  console.log(`Files: ${files.length}`)
  console.log(`Sentences: ${segments.length}`)

  for (const [i, f] of files.entries()) {
    const anns = extractAnnotations(markdowns[i])
    console.log(`  ${f.split("/").pop()}: ${anns.length} annotations`)
  }
  console.log()

  const allRuns = markdowns.map((md) => [mdToSectionResult(md, referenceText, segments)])
  const result = compareRuns(allRuns)

  console.log(formatComparison(result))

  if (args.out) {
    writeFileSync(resolve(args.out), JSON.stringify(result, null, 2))
    console.log(`\nResults written to: ${args.out}`)
  }
}

main()
