import type { FileStore } from "~/lib/files/store"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
import type { DetectCalls } from "./detect/types"
import type { RegionsBlock } from "~/domain/data-blocks/regions/schema"

export type WriteOutcome = "written" | "unchanged" | "failed"

export interface RegionSyncDeps {
  getFiles: () => FileStore
  getFile: (path: string) => string | undefined
  subscribe: (listener: () => void) => () => void
  getKinds: () => KindDescriptor[]
  detect: DetectCalls
  writeRegions: (path: string, next: RegionsBlock) => WriteOutcome
  onProgress?: (processed: number, total: number) => void
}

export interface RegionSyncHandle {
  ready: Promise<void>
  tick: () => Promise<void>
  stop: () => void
}
