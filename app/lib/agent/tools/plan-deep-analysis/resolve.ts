import type { FileEntry } from "../file-entry"
import type { SearchHit } from "~/domain/search/types"
import type { TargetEntry } from "./def"
import { showProgress } from "../../client/store"
import { getFiles } from "~/lib/files/store"
import { getDatabase } from "~/domain/db/database"
import { getLlmHost } from "~/lib/agent/env"
import { buildSemanticContext } from "~/domain/corpus/init"
import { findSearchById } from "~/domain/data-blocks/settings/searches/selectors"
import { runSearchPipeline } from "~/lib/search/pipeline"

export interface FileHitGroup {
  texts: string[]
  bestScore: number
}

export interface ResolvedTargets {
  files: FileEntry[]
  searchIds: string[]
  searchHits: Map<string, FileHitGroup>
  errors: string[]
}

const isSearchTarget = (t: FileEntry | TargetEntry): t is TargetEntry & { type: "search" } =>
  "type" in t && t.type === "search"

const groupHitsByFile = (hits: SearchHit[]): Map<string, FileHitGroup> => {
  const groups = new Map<string, FileHitGroup>()
  for (const hit of hits) {
    if (!hit.text) continue
    const group = groups.get(hit.file) ?? { texts: [], bestScore: 0 }
    group.texts.push(hit.text)
    group.bestScore = Math.max(group.bestScore, hit.score ?? 0)
    groups.set(hit.file, group)
  }
  return groups
}

export const resolveSearchTargets = async (
  targets: (FileEntry | TargetEntry)[]
): Promise<ResolvedTargets> => {
  const files: FileEntry[] = []
  const searchIds: string[] = []
  const searchHits = new Map<string, FileHitGroup>()
  const errors: string[] = []

  const db = getDatabase()

  for (const target of targets) {
    if (!isSearchTarget(target)) {
      files.push({ path: target.path, group: target.group })
      continue
    }

    const entry = findSearchById(getFiles(), target.search_id)
    if (!entry) {
      errors.push(`Search not found: ${target.search_id}`)
      continue
    }

    if (!db) {
      errors.push(`No database available to execute search: ${entry.sql}`)
      continue
    }

    const ctx = await buildSemanticContext(db, getLlmHost())
    const allFiles = getFiles()

    const hitCount = { total: 0, files: new Set<string>() }
    const onBatchResults = (batch: SearchHit[]) => {
      for (const hit of batch) hitCount.files.add(hit.file)
      hitCount.total += batch.length
      showProgress(`Found ${hitCount.total} results across ${hitCount.files.size} files`)
    }

    const result = await runSearchPipeline(
      entry.sql,
      entry.highlight,
      {
        ...ctx,
        cachedHydes: entry.hydes,
        cachedDescriptionsHash: entry.descriptionsHash,
      },
      allFiles,
      100,
      onBatchResults
    )

    if (!result.ok) {
      errors.push(`Search failed: ${entry.sql} — ${result.error.message}`)
      continue
    }

    if (result.value.hits.length === 0) {
      errors.push(`Search resolved to no results: ${entry.sql}`)
      continue
    }

    const fileGroups = groupHitsByFile(result.value.hits)
    const searchFiles = [...fileGroups.keys()].map((path): FileEntry => ({ path, group: "Search" }))

    for (const [path, group] of fileGroups) {
      const existing = searchHits.get(path) ?? { texts: [], bestScore: 0 }
      existing.texts.push(...group.texts)
      existing.bestScore = Math.max(existing.bestScore, group.bestScore)
      searchHits.set(path, existing)
    }

    console.debug(
      `[plan-deep] search ${target.search_id} resolved ${result.value.hits.length} hits → ${fileGroups.size} files`
    )

    files.push(...searchFiles)
    searchIds.push(target.search_id)
  }

  return { files, searchIds, searchHits, errors }
}
