import type { FileStore } from "~/lib/files/store"
import { debounce } from "~/lib/utils/debounce"
import { processPool } from "~/lib/utils/pool"
import { isEmbeddableFile } from "~/lib/embeddings/filter"
import { companionFilename } from "~/lib/embeddings/companion"
import { planEmbedFilePass } from "~/lib/embeddings/sync"
import {
  collectExisting,
  planClassifyFilePass,
  writeClassificationToAttributes,
} from "~/lib/corpus/sync-topics"
import { classifyDocument, type ExistingClassifications } from "~/lib/corpus/classify"
import { processDescriptionSync } from "~/lib/corpus/sync-descriptions"
import {
  planRegionFilePass,
  seedVocabulary,
  RegionWriteFailure,
  MAX_CONSECUTIVE_WRITE_FAILURES,
} from "~/lib/regions/sync"
import { needsSharedVocabulary } from "~/lib/regions/detect/find"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
import {
  STAGE_ORDER,
  type EngineDeps,
  type EngineHandle,
  type EngineStage,
  type EngineStatus,
  type StagePassPlan,
} from "./types"

export const ENGINE_DEBOUNCE = 5_000
export const ENGINE_MAX_WAIT = 30_000

interface PlannedStage {
  stage: EngineStage
  plan: StagePassPlan
  quarantined: boolean
}

interface FilePlan {
  path: string
  content: string
  stages: PlannedStage[]
}

interface WriteFailure {
  count: number
  content: string
}

const pairKey = (stage: EngineStage, path: string): string => `${stage} ${path}`

const pathOfPairKey = (key: string): string => key.slice(key.indexOf(" ") + 1)

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const startEngine = (deps: EngineDeps): EngineHandle => {
  let previous: FileStore = {}
  const settledPairs = new Set<string>()
  const retryPairs = new Set<string>()
  const writeFailures = new Map<string, WriteFailure>()

  let stopped = false
  let aborted = false
  let running: Promise<void> | null = null
  let rerunRequested = false
  let firstPassSettled = false
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  const emit = (path: string, stage: EngineStage, status: EngineStatus, error?: string): void =>
    deps.onEvent({ file: path, stage, status, ...(error !== undefined ? { error } : {}) })

  const isQuarantined = (path: string, content: string): boolean => {
    const failure = writeFailures.get(path)
    return (
      failure !== undefined &&
      failure.count >= MAX_CONSECUTIVE_WRITE_FAILURES &&
      failure.content === content
    )
  }

  const recordWriteFailure = (path: string, content: string): void => {
    const count = (writeFailures.get(path)?.count ?? 0) + 1
    writeFailures.set(path, { count, content })
    if (count === MAX_CONSECUTIVE_WRITE_FAILURES) {
      console.error(`[engine] quarantining ${path} after ${count} consecutive write failures`)
    }
  }

  const forgetPath = (path: string): void => {
    writeFailures.delete(path)
    for (const stage of STAGE_ORDER) {
      settledPairs.delete(pairKey(stage, path))
      retryPairs.delete(pairKey(stage, path))
    }
  }

  const cleanUpDeleted = (path: string): void => {
    const companion = companionFilename(path)
    if (deps.getFile(companion) !== undefined) deps.deleteFile(companion)
    forgetPath(path)
  }

  const buildFilePlan = (
    path: string,
    content: string,
    existing: ExistingClassifications,
    knownValuesFor: (kind: KindDescriptor) => Set<string>,
    kinds: KindDescriptor[]
  ): FilePlan => {
    const quarantined = isQuarantined(path, content)
    const regions: StagePassPlan = quarantined
      ? { dirty: false, run: () => Promise.resolve() }
      : planRegionFilePass(path, content, kinds, knownValuesFor, {
          getFile: deps.getFile,
          detect: deps.detect,
          writeRegions: deps.writeRegions,
          isAborted: () => aborted,
        })

    return {
      path,
      content,
      stages: [
        {
          stage: "embed",
          plan: planEmbedFilePass(path, content, {
            getFile: deps.getFile,
            updateFile: deps.updateFile,
            deleteFile: deps.deleteFile,
            embeddingsUrl: deps.embeddingsUrl,
            fetchBatch: deps.fetchBatch,
          }),
          quarantined: false,
        },
        {
          stage: "classify",
          plan: planClassifyFilePass(
            path,
            content,
            existing,
            deps.classify ?? classifyDocument,
            deps.writeClassification ?? writeClassificationToAttributes
          ),
          quarantined: false,
        },
        { stage: "regions", plan: regions, quarantined },
      ],
    }
  }

  const runStage = async (path: string, content: string, planned: PlannedStage): Promise<void> => {
    if (planned.quarantined) return

    const key = pairKey(planned.stage, path)
    if (planned.plan.dirty) emit(path, planned.stage, "working")

    try {
      await planned.plan.run()
    } catch (e) {
      if (e instanceof RegionWriteFailure) recordWriteFailure(path, content)
      console.error(`[engine] ${planned.stage} failed for ${path}:`, e)
      emit(path, planned.stage, "failed", errorMessage(e))
      if (isQuarantined(path, content)) retryPairs.delete(key)
      else retryPairs.add(key)
      return
    }

    retryPairs.delete(key)
    if (planned.plan.dirty || !settledPairs.has(key)) {
      settledPairs.add(key)
      emit(path, planned.stage, "settled")
    }
  }

  const finalize = async (filePlan: FilePlan): Promise<void> => {
    for (const planned of filePlan.stages) {
      if (aborted) return
      await runStage(filePlan.path, filePlan.content, planned)
    }
  }

  const runTail = async (): Promise<void> => {
    try {
      const languages = await deps.getSignificantLanguages()
      await (deps.syncDescriptions ?? processDescriptionSync)(
        deps.getFiles,
        languages,
        deps.embeddingsUrl
      )
    } catch (e) {
      console.error("[engine] corpus tail failed:", e)
    }
  }

  const candidatePaths = (files: FileStore): string[] => {
    const changed = Object.keys(files).filter(
      (path) => isEmbeddableFile(path) && files[path] !== previous[path]
    )
    const retriable = [...retryPairs].map(pathOfPairKey).filter((path) => path in files)
    return [...new Set([...changed, ...retriable])]
  }

  const runPass = async (): Promise<void> => {
    try {
      const files = { ...deps.getFiles() }

      for (const path of Object.keys(previous)) {
        if (isEmbeddableFile(path) && !(path in files)) cleanUpDeleted(path)
      }

      const candidates = candidatePaths(files)
      if (candidates.length > 0) {
        const kinds = deps.getKinds()
        const existing = collectExisting(files)
        const vocabByKind = new Map<string, Set<string>>()
        const knownValuesFor = (kind: KindDescriptor): Set<string> => {
          if (!needsSharedVocabulary(kind.valueType)) return new Set()
          const cached = vocabByKind.get(kind.id)
          if (cached) return cached
          const seeded = seedVocabulary(files, kind.id)
          vocabByKind.set(kind.id, seeded)
          return seeded
        }

        const plans = candidates.map((path) =>
          buildFilePlan(path, files[path], existing, knownValuesFor, kinds)
        )

        for (const filePlan of plans) {
          for (const planned of filePlan.stages) {
            if (planned.plan.dirty) emit(filePlan.path, planned.stage, "queued")
          }
        }

        await processPool(
          plans,
          async (filePlan) => {
            await finalize(filePlan)
            return []
          },
          () => undefined,
          {}
        )

        if (!aborted) await runTail()
      }

      previous = files
    } catch (e) {
      console.error("[engine] pass error:", e)
    } finally {
      if (!firstPassSettled) {
        firstPassSettled = true
        resolveReady()
      }
    }
  }

  const runChain = async (): Promise<void> => {
    try {
      await runPass()
      while (rerunRequested && !stopped) {
        rerunRequested = false
        await runPass()
      }
    } finally {
      running = null
    }
  }

  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (running) {
      rerunRequested = true
      return running
    }
    aborted = false
    running = runChain()
    return running
  }

  const debouncedTick = debounce(() => void tick(), ENGINE_DEBOUNCE, {
    maxWait: ENGINE_MAX_WAIT,
  })
  const unsubscribe = deps.subscribe(debouncedTick)

  const stop = (): void => {
    stopped = true
    aborted = true
    rerunRequested = false
    debouncedTick.cancel()
    unsubscribe()
    resolveReady()
  }

  void tick()

  return { ready, tick, stop }
}
