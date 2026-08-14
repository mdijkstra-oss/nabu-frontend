import { getFiles, getFile, updateFileRaw, deleteFile } from "~/lib/files/store"
import { subscribeContentChanges } from "~/lib/files/subscribe-content"
import { getEmbeddingsUrl } from "~/lib/embeddings/env"
import { regionKinds } from "~/lib/regions/kinds/registry"
import { runFind } from "~/lib/regions/detect/find"
import { runMark } from "~/lib/regions/detect/mark"
import { writeRegionsBlock } from "~/domain/regions/init"
import { setCorpusTick, getSignificantLanguages } from "~/domain/corpus/init"
import { startEngine } from "~/lib/engine/engine"
import type { EngineEvent, EngineHandle } from "~/lib/engine/types"

type Listener = (event: EngineEvent) => void

const listeners = new Set<Listener>()

export const subscribeEngineEvents = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let handle: EngineHandle | null = null

export const startProjectEngine = (): EngineHandle => {
  const started = startEngine({
    getFiles,
    getFile,
    updateFile: updateFileRaw,
    deleteFile,
    subscribe: subscribeContentChanges,
    embeddingsUrl: getEmbeddingsUrl(),
    getKinds: regionKinds,
    detect: { find: runFind, mark: runMark },
    writeRegions: writeRegionsBlock,
    getSignificantLanguages,
    onEvent: (event) => {
      for (const listener of listeners) listener(event)
    },
  })
  handle = started
  setCorpusTick(started.tick)
  return started
}

export const stopProjectEngine = (): void => {
  handle?.stop()
  handle = null
}
