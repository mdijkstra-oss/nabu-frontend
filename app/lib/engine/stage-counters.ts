import type { EngineEvent, EngineStage } from "./types"

export interface StageCounters {
  settled: number
  total: number
}

export type StageCounterMap = Record<EngineStage, StageCounters>

export const emptyStageCounters = (): StageCounterMap => ({
  embed: { settled: 0, total: 0 },
  classify: { settled: 0, total: 0 },
  regions: { settled: 0, total: 0 },
})

interface StageSets {
  seen: Set<string>
  done: Set<string>
}

interface StageCounterFold {
  apply: (event: EngineEvent) => StageCounterMap
  counters: () => StageCounterMap
}

export const createStageCounterFold = (): StageCounterFold => {
  const stages: Record<EngineStage, StageSets> = {
    embed: { seen: new Set(), done: new Set() },
    classify: { seen: new Set(), done: new Set() },
    regions: { seen: new Set(), done: new Set() },
  }

  const counters = (): StageCounterMap => ({
    embed: { settled: stages.embed.done.size, total: stages.embed.seen.size },
    classify: { settled: stages.classify.done.size, total: stages.classify.seen.size },
    regions: { settled: stages.regions.done.size, total: stages.regions.seen.size },
  })

  const apply = (event: EngineEvent): StageCounterMap => {
    const sets = stages[event.stage]
    sets.seen.add(event.file)
    if (event.status === "settled" || event.status === "failed") sets.done.add(event.file)
    return counters()
  }

  return { apply, counters }
}

export const foldStageCounters = (events: EngineEvent[]): StageCounterMap => {
  const fold = createStageCounterFold()
  for (const event of events) fold.apply(event)
  return fold.counters()
}
