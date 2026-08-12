import { executeFileAction } from "~/lib/data-blocks/file-action"
import { patchBlockContent } from "~/lib/data-blocks/patch"
import { getFile, getFileRaw, getFiles } from "~/lib/files/store"
import { subscribeContentChanges } from "~/lib/files/subscribe-content"
import type { JsonPatchOp } from "~/lib/patch/structured-json/apply"
import { sweepUnregisteredKinds } from "~/lib/regions/boot-sweep"
import { REGIONS_LANGUAGE } from "~/lib/regions/decorate/resolve"
import { runFind } from "~/lib/regions/detect/find"
import { runMark } from "~/lib/regions/detect/mark"
import { regionKinds } from "~/lib/regions/kinds/registry"
import { startRegionSync } from "~/lib/regions/sync"
import type { RegionSyncHandle, WriteOutcome } from "~/lib/regions/sync-types"
import type { RegionsBlock } from "~/domain/data-blocks/regions/schema"

type OnSyncProgress = (processed: number, total: number) => void

let handle: RegionSyncHandle | null = null

const toOps = (next: RegionsBlock): JsonPatchOp[] => [
  { op: "add", path: "/regions", value: next.regions },
  { op: "add", path: "/scanned", value: next.scanned },
]

export const writeRegionsBlock = (path: string, next: RegionsBlock): WriteOutcome => {
  const ops = toOps(next)
  const result = patchBlockContent(getFileRaw(path), REGIONS_LANGUAGE, ops)
  if (!result.ok) return result.error === "No changes" ? "unchanged" : "failed"

  executeFileAction({
    patches: [{ path, language: REGIONS_LANGUAGE, ops }],
    skipPendingRefs: true,
  })
  return "written"
}

export const sweepRemovedKinds = (): void =>
  sweepUnregisteredKinds({ getFiles, getKinds: regionKinds, writeRegions: writeRegionsBlock })

export const startRegions = async (onProgress?: OnSyncProgress): Promise<void> => {
  handle = startRegionSync({
    getFiles,
    getFile,
    subscribe: subscribeContentChanges,
    getKinds: regionKinds,
    detect: { find: runFind, mark: runMark },
    writeRegions: writeRegionsBlock,
    onProgress,
  })

  await handle.ready
}

export const stopRegions = (): void => {
  handle?.stop()
  handle = null
}
