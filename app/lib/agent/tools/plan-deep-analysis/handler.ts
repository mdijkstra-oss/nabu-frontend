import type { FileEntry } from "../file-entry"
import { planDeepAnalysisTool, PlanDeepAnalysisArgs } from "./def"
import { registerTool, tool } from "../../executors/tool"
import { showProgress } from "../../client/store"
import { activatePlan } from "../../executors/modes"
import { buildAutoSteps, buildExecRules, toSectionMatches, bucketSearchSections } from "./format"
import type {
  LabeledTarget,
  SourceEntry,
  SectionEntry,
  ScoredSection,
  SectionMatch,
} from "./format"
import { findMatchOffset } from "~/lib/text/find"
import { parseCodeBlocks, extractProse, mapProseOffset } from "~/lib/data-blocks/parse"
import { errorMessage } from "~/lib/utils/error"
import { mergeOverlapping } from "~/lib/utils/ranges"
import { resolveSearchTargets } from "./resolve"
import type { SearchHit } from "~/domain/search/types"
import { filterFileTargets } from "./filter"
import { labelAll } from "./label"
import { getFileView } from "../file-view"
import {
  findMissingFiles,
  buildFramework,
  validateAnnotationSources,
  pushSourceBlocks,
  pushTargetBlocks,
  injectMemory,
} from "./context"

const isSearchFile = (f: FileEntry): boolean => f.group === "Search"

const lineAtChar = (content: string, charIndex: number): number => {
  let line = 1
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === "\n") line++
  }
  return line
}

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : text.slice(0, max) + "…"

export const mergeOverlappingSections = (sections: SectionEntry[]): SectionEntry[] =>
  mergeOverlapping(
    sections,
    (s) => s.startLine,
    (s) => s.endLine,
    (a, b) => ({ ...a, endLine: Math.max(a.endLine, b.endLine) })
  )

export const sectionCharCount = (content: string, sections: SectionEntry[]): number => {
  const lines = content.split("\n")
  let total = 0
  for (const s of sections) {
    const start = Math.max(0, s.startLine - 1)
    const end = Math.min(lines.length, s.endLine)
    for (let i = start; i < end; i++) total += lines[i].length + 1
  }
  return total
}

const locateHitSections = (content: string, path: string, hitTexts: string[]): SectionEntry[] => {
  const blocks = parseCodeBlocks(content)
  const prose = extractProse(content)
  const located: SectionEntry[] = []
  const lost: string[] = []

  for (const text of hitTexts) {
    const needleProse = extractProse(text)
    const match = findMatchOffset(prose, needleProse)
    if (!match) {
      lost.push(truncate(text.replace(/\n/g, "\\n"), 120))
      continue
    }
    const startLine = lineAtChar(content, mapProseOffset(match.start, blocks))
    const endLine = lineAtChar(content, mapProseOffset(match.end, blocks))
    located.push({ path, startLine, endLine })
  }

  if (lost.length > 0) {
    console.debug(
      `[plan-search-hits] ${path}: ${located.length}/${hitTexts.length} located, ${lost.length} lost`
    )
    for (const t of lost) console.debug(`[plan-search-hits]   lost: ${t}`)
  }

  return located
}

const sliceLines = (content: string, startLine: number, endLine: number): string =>
  content
    .split("\n")
    .slice(startLine - 1, endLine)
    .join("\n")

const locateHit = (hit: SearchHit): SectionEntry | null => {
  if (!hit.text) return null
  const content = getFileView(hit.file)
  if (content === undefined) return null
  const sections = locateHitSections(content, hit.file, [hit.text])
  return sections[0] ?? null
}

const markHitInSection = (sectionText: string, hitText: string): string => {
  const hitProse = extractProse(hitText)
  const match = findMatchOffset(sectionText, hitProse)
  if (!match) return sectionText
  const before = sectionText.slice(0, match.start)
  const bold = sectionText.slice(match.start, match.end)
  const after = sectionText.slice(match.end)
  return `${before}**${bold}**${after}`
}

const logScoredSection = (hit: SearchHit, section: SectionEntry, content: string): void => {
  if (!hit.text) return
  const sectionText = sliceLines(content, section.startLine, section.endLine)
  const marked = markHitInSection(sectionText, hit.text)
  console.debug(
    `[plan-search-hits] ${hit.file} [${section.startLine}-${section.endLine}] (score: ${hit.score ?? "?"})\n${marked}`
  )
}

interface ScoredResult {
  scored: ScoredSection[]
  hitTexts: Map<string, string>
}

const sectionKey = (s: SectionEntry): string => `${s.path}\0${s.startLine}\0${s.endLine}`

const toScoredSections = (hits: SearchHit[]): ScoredResult => {
  let located = 0
  let lost = 0
  const hitTexts = new Map<string, string>()

  const scored = hits.flatMap((hit) => {
    const section = locateHit(hit)
    if (!section) {
      lost++
      return []
    }
    located++
    const content = getFileView(hit.file)
    if (content === undefined) return []
    logScoredSection(hit, section, content)
    if (hit.text) hitTexts.set(sectionKey(section), hit.text)
    const chars = sectionCharCount(content, [section])
    return [{ section, chars }]
  })

  console.debug(
    `[plan-search-hits] summary: ${hits.length} hits → ${located} located, ${lost} lost`
  )

  return { scored, hitTexts }
}

const logStepMap = (steps: SectionMatch[], hitTexts: Map<string, string>): void => {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    console.debug(`[plan-step-map] step ${i + 1}: "${step.label}"`)

    for (const section of step.sections) {
      const content = getFileView(section.path)
      if (!content) {
        console.debug(
          `[plan-step-map]   ${section.path} [${section.startLine}-${section.endLine}] (file not found)`
        )
        continue
      }
      const sectionText = sliceLines(content, section.startLine, section.endLine)
      const hitText = hitTexts.get(sectionKey(section))
      const marked = hitText ? markHitInSection(sectionText, hitText) : sectionText
      console.debug(
        `[plan-step-map]   ${section.path} [${section.startLine}-${section.endLine}]\n${marked}`
      )
    }
  }
}

const buildTaskDescription = (searchIds: string[], labeled: LabeledTarget[]): string => {
  const searchRefs = searchIds.map((id) => `file://${id}`)
  const desc =
    searchRefs.length > 0
      ? searchRefs.join(", ")
      : [...new Set(labeled.map((t) => t.path))].join(", ")
  return `Deep analysis: ${desc}`
}

registerTool(
  tool({
    ...planDeepAnalysisTool,
    schema: PlanDeepAnalysisArgs,
    handler: async (_files, { source_files, target_files, post_action, interactive }) => {
      showProgress("Searching corpus…")
      const {
        files: resolvedTargets,
        searchIds,
        orderedHits,
        errors,
      } = await resolveSearchTargets(target_files)
      if (errors.length > 0) return { status: "error", output: errors.join("\n"), mutations: [] }

      const missing = findMissingFiles(source_files)
      if (missing.length > 0)
        return { status: "error", output: `Files not found: ${missing.join(", ")}`, mutations: [] }

      if (post_action === "annotate_as_code") {
        const mismatch = validateAnnotationSources(source_files)
        if (mismatch) return { status: "error", output: mismatch, mutations: [] }
      }

      pushSourceBlocks(source_files)
      const framework = buildFramework(source_files)

      const explicitFiles = resolvedTargets.filter((f) => !isSearchFile(f))
      const searchFiles = resolvedTargets.filter(isSearchFile)
      console.debug(
        `[plan-search] targets: ${explicitFiles.length} explicit, ${searchFiles.length} search files`
      )

      let labeled: LabeledTarget[]
      try {
        showProgress("Preselecting sections…")
        const fileItems = await filterFileTargets(explicitFiles, framework)
        console.debug(`[plan-search] filter done: ${fileItems.length} file items → labeling`)
        showProgress("Labeling sections…")
        labeled = await labelAll(fileItems)
      } catch (e) {
        return { status: "error", output: errorMessage(e), mutations: [] }
      }

      pushTargetBlocks(labeled)
      injectMemory()

      const fileMatches = toSectionMatches(labeled)

      const { scored: scoredSections, hitTexts } = toScoredSections(orderedHits)
      const searchMatches = bucketSearchSections(scoredSections)
      logStepMap(searchMatches, hitTexts)
      console.debug(
        `[plan-search] search bucketing: ${scoredSections.length} sections → ${searchMatches.length} steps`
      )

      const allMatches = [...fileMatches, ...searchMatches]
      if (allMatches.length === 0) return { status: "ok", output: "ok", mutations: [] }

      const sourceEntries: SourceEntry[] = source_files.map((f) => ({
        path: f.path,
        scope: f.group,
      }))
      const steps = buildAutoSteps(allMatches, sourceEntries, post_action, interactive)
      activatePlan(buildTaskDescription(searchIds, labeled), steps, [])

      return {
        status: "ok",
        output: "ok",
        directive: buildExecRules(steps[0].expected),
        mutations: [],
      }
    },
  })
)
