import type { FileEntry } from "../file-entry"
import type { SearchHit } from "~/domain/search/types"
import type { TargetEntry } from "./def"
import { showProgress } from "../../client/store"
import { executeSearchById } from "~/domain/search/execute"

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

const mergeHitGroups = (
  target: Map<string, FileHitGroup>,
  source: Map<string, FileHitGroup>
): void => {
  for (const [path, group] of source) {
    const existing = target.get(path) ?? { texts: [], bestScore: 0 }
    existing.texts.push(...group.texts)
    existing.bestScore = Math.max(existing.bestScore, group.bestScore)
    target.set(path, existing)
  }
}

const buildProgressCallback = () => {
  const hitCount = { total: 0, files: new Set<string>() }
  return (batch: SearchHit[]) => {
    for (const hit of batch) hitCount.files.add(hit.file)
    hitCount.total += batch.length
    showProgress(`Found ${hitCount.total} candidates across ${hitCount.files.size} files`)
  }
}

export const resolveSearchTargets = async (
  targets: (FileEntry | TargetEntry)[]
): Promise<ResolvedTargets> => {
  const files: FileEntry[] = []
  const searchIds: string[] = []
  const searchHits = new Map<string, FileHitGroup>()
  const errors: string[] = []

  for (const target of targets) {
    if (!isSearchTarget(target)) {
      files.push({ path: target.path, group: target.group })
      continue
    }

    const result = await executeSearchById(target.search_id, 1000, buildProgressCallback())

    if (!result.ok) {
      errors.push(result.error)
      continue
    }

    if (result.value.length === 0) {
      errors.push(`Search resolved to no results: ${target.search_id}`)
      continue
    }

    const fileGroups = groupHitsByFile(result.value)
    mergeHitGroups(searchHits, fileGroups)

    const searchFiles = [...fileGroups.keys()].map((path): FileEntry => ({ path, group: "Search" }))
    files.push(...searchFiles)
    searchIds.push(target.search_id)

    console.debug(
      `[plan-deep] search ${target.search_id} resolved ${result.value.length} hits → ${fileGroups.size} files`
    )
  }

  return { files, searchIds, searchHits, errors }
}
