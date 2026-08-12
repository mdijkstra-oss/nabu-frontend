import { isObject } from "~/lib/data-blocks/json"
import { findSingletonBlock } from "~/lib/data-blocks/parse"
import { isEmbeddableFile } from "~/lib/embeddings/filter"
import { stripPendingRefs } from "~/lib/files/pending-refs"
import type { FileStore } from "~/lib/files/store"
import { canonicalizeRegionsBlock } from "~/domain/data-blocks/regions/canonical"
import type { RegionsBlock } from "~/domain/data-blocks/regions/schema"
import { REGIONS_LANGUAGE } from "./decorate/resolve"
import type { KindDescriptor } from "./kinds/registry"
import { readStoredRegions } from "./stored"
import type { WriteOutcome } from "./sync-types"

export interface RegionSweepDeps {
  getFiles: () => FileStore
  getKinds: () => KindDescriptor[]
  writeRegions: (path: string, next: RegionsBlock) => WriteOutcome
}

const kindOf = (row: unknown): string[] =>
  isObject(row) && typeof row.kind === "string" ? [row.kind] : []

const kindIdsOnDisk = (raw: string): string[] => {
  const block = findSingletonBlock(raw, REGIONS_LANGUAGE)
  if (!block) return []

  try {
    const json: unknown = JSON.parse(stripPendingRefs(block.content))
    if (!isObject(json)) return []
    const rows = Array.isArray(json.regions) ? json.regions : []
    const scanned = isObject(json.scanned) ? Object.keys(json.scanned) : []
    return [...rows.flatMap(kindOf), ...scanned]
  } catch {
    return []
  }
}

const withoutUnregisteredKinds = (block: RegionsBlock, registered: Set<string>): RegionsBlock => ({
  regions: block.regions.filter((row) => registered.has(row.kind)),
  scanned: Object.fromEntries(
    Object.entries(block.scanned).filter(([kind]) => registered.has(kind))
  ),
})

export const sweepUnregisteredKinds = (deps: RegionSweepDeps): void => {
  const files = deps.getFiles()
  const registered = new Set(deps.getKinds().map((kind) => kind.id))

  for (const path of Object.keys(files)) {
    if (!isEmbeddableFile(path)) continue
    if (kindIdsOnDisk(files[path]).every((kind) => registered.has(kind))) continue

    const surviving = withoutUnregisteredKinds(readStoredRegions(files[path]), registered)
    try {
      deps.writeRegions(path, canonicalizeRegionsBlock(surviving))
    } catch (e) {
      console.error(`[region-sweep] write failed for ${path}:`, e)
    }
  }
}
