import type { FileStore } from "~/lib/files/store"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
import type { DetectCalls } from "~/lib/regions/detect/types"
import type { RegionsBlock } from "~/domain/data-blocks/regions/schema"
import type { WriteOutcome } from "~/lib/regions/sync-types"
import type { fetchEmbeddingBatch } from "~/lib/embeddings/client"
import type { classifyDocument } from "~/lib/corpus/classify"
import type { writeClassificationToAttributes } from "~/lib/corpus/sync-topics"
import type { processDescriptionSync } from "~/lib/corpus/sync-descriptions"

export type EngineStage = "embed" | "classify" | "regions"

export const STAGE_ORDER: EngineStage[] = ["embed", "classify", "regions"]

export type EngineStatus = "queued" | "working" | "settled" | "failed"

export interface EngineEvent {
  file: string
  stage: EngineStage
  status: EngineStatus
  error?: string
}

export interface EngineDeps {
  getFiles: () => FileStore
  getFile: (path: string) => string | undefined
  updateFile: (path: string, content: string) => void
  deleteFile: (path: string) => void
  subscribe: (listener: () => void) => () => void
  embeddingsUrl: string
  fetchBatch?: typeof fetchEmbeddingBatch
  classify?: typeof classifyDocument
  writeClassification?: typeof writeClassificationToAttributes
  getKinds: () => KindDescriptor[]
  detect: DetectCalls
  writeRegions: (path: string, next: RegionsBlock) => WriteOutcome
  getSignificantLanguages: () => Promise<string[]>
  syncDescriptions?: typeof processDescriptionSync
  onEvent: (event: EngineEvent) => void
}

export interface EngineHandle {
  ready: Promise<void>
  tick: () => Promise<void>
  stop: () => void
}

export interface StagePassPlan {
  dirty: boolean
  run: () => Promise<void>
}
