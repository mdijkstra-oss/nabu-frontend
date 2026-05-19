import type { Result } from "~/lib/fp/result"
import type { SearchHit } from "~/domain/search/types"
import type { SemanticContext } from "~/lib/search/resolve-semantic"
import type { CodeBlock } from "~/lib/data-blocks/parse"
import { ok, err } from "~/lib/fp/result"
import { findMatchOffset } from "~/lib/text/find"
import { charOffsetToLine } from "~/lib/text/lines"
import { extractProse, parseCodeBlocks } from "~/lib/data-blocks/parse"
import { resolveSemanticSql } from "~/lib/search/resolve-semantic"
import { executeSearch, executeHybridLocal } from "~/lib/search/execute"
import { normalizeLlmSql } from "~/lib/sql/normalize"
import { stripPaging } from "~/lib/search/paging"

export interface FileSection {
  type: "file"
  path: string
  start_line: number
  end_line: number
}

export interface QuerySection {
  type: "query"
  sql: string
}

export type SectionSource = FileSection | QuerySection

export interface ResolvedSection {
  path: string
  startLine: number
  endLine: number
}

export const proseOffsetToOriginal = (blocks: CodeBlock[], proseOffset: number): number => {
  let accumulated = 0
  for (const block of blocks) {
    const blockLength = block.end - block.start
    const gapStart = block.start - accumulated
    if (proseOffset < gapStart) break
    accumulated += blockLength
  }
  return proseOffset + accumulated
}

export const resolveHitToLineRange = (
  hitText: string,
  fileContent: string
): ResolvedSection | null => {
  const prose = extractProse(fileContent)
  const match = findMatchOffset(prose, hitText)
  if (!match) return null

  const blocks = parseCodeBlocks(fileContent)
  const originalStart = proseOffsetToOriginal(blocks, match.start)
  const originalEnd = proseOffsetToOriginal(blocks, match.end)

  const startLine = charOffsetToLine(fileContent, originalStart) + 1
  const endLine = charOffsetToLine(fileContent, originalEnd) + 1

  return { path: "", startLine, endLine }
}

export const mergeOverlappingRanges = (ranges: ResolvedSection[]): ResolvedSection[] => {
  if (ranges.length === 0) return []

  const sorted = [...ranges].sort((a, b) =>
    a.path !== b.path ? a.path.localeCompare(b.path) : a.startLine - b.startLine
  )

  const merged: ResolvedSection[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const last = merged[merged.length - 1]

    const isAdjacentOrOverlapping =
      current.path === last.path && current.startLine <= last.endLine + 1

    if (isAdjacentOrOverlapping) {
      merged[merged.length - 1] = {
        ...last,
        endLine: Math.max(last.endLine, current.endLine),
      }
    } else {
      merged.push(current)
    }
  }

  return merged
}

const resolveFileSection = (source: FileSection): ResolvedSection => ({
  path: source.path,
  startLine: source.start_line,
  endLine: source.end_line,
})

const resolveQueryHits = (
  hits: SearchHit[],
  getContent: (path: string) => string | undefined
): ResolvedSection[] =>
  hits.flatMap((hit) => {
    const content = getContent(hit.file)
    if (!content) return []
    if (!hit.text) return []
    const resolved = resolveHitToLineRange(hit.text, content)
    if (!resolved) return []
    return [{ ...resolved, path: hit.file }]
  })

const executeResolvedQuery = async (
  sql: string,
  ctx: SemanticContext
): Promise<Result<SearchHit[], string>> => {
  const normalized = normalizeLlmSql(sql)
  const stripped = stripPaging(normalized)
  const resolved = await resolveSemanticSql(stripped, ctx)
  if (!resolved.ok) return err(resolved.error.message)

  const hits =
    resolved.value.type === "hybrid"
      ? await executeHybridLocal(ctx.db, resolved.value.plan)
      : await executeSearch(ctx.db, resolved.value.sql)

  if (!hits.ok) return err(hits.error.message)
  return ok(hits.value)
}

export const resolveSectionSources = async (
  sources: SectionSource[],
  ctx: SemanticContext,
  getContent: (path: string) => string | undefined
): Promise<Result<ResolvedSection[], string>> => {
  const resolved: ResolvedSection[] = []

  for (const source of sources) {
    switch (source.type) {
      case "file":
        resolved.push(resolveFileSection(source))
        break
      case "query": {
        const hitsResult = await executeResolvedQuery(source.sql, ctx)
        if (!hitsResult.ok) return err(hitsResult.error)
        resolved.push(...resolveQueryHits(hitsResult.value, getContent))
        break
      }
      default:
        throw new Error(`unknown section source type: ${(source as { type: string }).type}`)
    }
  }

  return ok(mergeOverlappingRanges(resolved))
}
