import type { FileEntry } from "../file-entry"
import type { SearchHit } from "~/domain/search/types"
import type { TargetEntry } from "./def"
import { showProgress } from "../../client/store"
import { executeSearchById } from "~/domain/search/execute"

export interface ResolvedTargets {
  files: FileEntry[]
  searchIds: string[]
  orderedHits: SearchHit[]
  errors: string[]
}

const isSearchTarget = (t: FileEntry | TargetEntry): t is TargetEntry & { type: "search" } =>
  "type" in t && t.type === "search"

const uniqueFilePaths = (hits: SearchHit[]): string[] => {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const hit of hits) {
    if (!seen.has(hit.file)) {
      seen.add(hit.file)
      paths.push(hit.file)
    }
  }
  return paths
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
  const orderedHits: SearchHit[] = []
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

    const hitsWithText = result.value.filter((h) => h.text)
    orderedHits.push(...hitsWithText)

    const searchFiles = uniqueFilePaths(hitsWithText).map(
      (path): FileEntry => ({ path, group: "Search" })
    )
    files.push(...searchFiles)
    searchIds.push(target.search_id)
  }

  return { files, searchIds, orderedHits, errors }
}
