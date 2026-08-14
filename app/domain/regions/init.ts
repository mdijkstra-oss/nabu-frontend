import { executeFileAction } from "~/lib/data-blocks/file-action"
import { patchBlockContent } from "~/lib/data-blocks/patch"
import { getFileRaw, getFiles } from "~/lib/files/store"
import type { JsonPatchOp } from "~/lib/patch/structured-json/apply"
import { sweepUnregisteredKinds } from "~/lib/regions/boot-sweep"
import { REGIONS_LANGUAGE } from "~/lib/regions/decorate/resolve"
import { regionKinds } from "~/lib/regions/kinds/registry"
import type { WriteOutcome } from "~/lib/regions/sync-types"
import type { RegionsBlock } from "~/domain/data-blocks/regions/schema"

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

const toOps = (next: RegionsBlock): JsonPatchOp[] => [
  { op: "add", path: "/regions", value: next.regions },
  { op: "add", path: "/scanned", value: next.scanned },
]
