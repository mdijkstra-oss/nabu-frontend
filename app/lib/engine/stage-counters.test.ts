import { describe, it, expect } from "vitest"
import {
  createStageCounterFold,
  foldStageCounters,
  emptyStageCounters,
  type StageCounterMap,
} from "./stage-counters"
import type { EngineEvent, EngineStage, EngineStatus } from "./types"

describe("stage counter fold", () => {
  const ev = (file: string, stage: EngineStage, status: EngineStatus): EngineEvent => ({
    file,
    stage,
    status,
  })

  const map = (
    embed: [number, number],
    classify: [number, number],
    regions: [number, number]
  ): StageCounterMap => ({
    embed: { settled: embed[0], total: embed[1] },
    classify: { settled: classify[0], total: classify[1] },
    regions: { settled: regions[0], total: regions[1] },
  })

  const cases: {
    name: string
    events: EngineEvent[]
    expected: StageCounterMap
  }[] = [
    {
      name: "empty stream folds to all zeros",
      events: [],
      expected: emptyStageCounters(),
    },
    {
      name: "mixed interleaved stream folds to per-stage counters",
      events: [
        ev("a.md", "embed", "queued"),
        ev("b.md", "embed", "queued"),
        ev("a.md", "embed", "working"),
        ev("a.md", "embed", "settled"),
        ev("a.md", "classify", "queued"),
        ev("b.md", "embed", "working"),
        ev("a.md", "classify", "working"),
        ev("b.md", "embed", "settled"),
        ev("a.md", "classify", "settled"),
        ev("a.md", "regions", "queued"),
      ],
      expected: map([2, 2], [1, 1], [0, 1]),
    },
    {
      name: "failed counts toward settled",
      events: [
        ev("a.md", "embed", "queued"),
        ev("a.md", "embed", "working"),
        ev("a.md", "embed", "failed"),
      ],
      expected: map([1, 1], [0, 0], [0, 0]),
    },
    {
      name: "file first appearing in a later pass grows total without shrinking any counter",
      events: [
        ev("a.md", "embed", "settled"),
        ev("a.md", "classify", "settled"),
        ev("a.md", "regions", "settled"),
        ev("b.md", "embed", "queued"),
        ev("b.md", "embed", "working"),
        ev("b.md", "embed", "settled"),
      ],
      expected: map([2, 2], [1, 1], [1, 1]),
    },
    {
      name: "re-dirtied pair re-emitting the lifecycle never regresses counters",
      events: [
        ev("a.md", "embed", "queued"),
        ev("a.md", "embed", "working"),
        ev("a.md", "embed", "settled"),
        ev("a.md", "embed", "queued"),
        ev("a.md", "embed", "working"),
        ev("a.md", "embed", "settled"),
      ],
      expected: map([1, 1], [0, 0], [0, 0]),
    },
    {
      name: "queued and working grow total but not settled",
      events: [
        ev("a.md", "embed", "queued"),
        ev("a.md", "embed", "working"),
        ev("b.md", "classify", "queued"),
      ],
      expected: map([0, 1], [0, 1], [0, 0]),
    },
    {
      name: "bare settled with nothing to do counts exactly like a worked file",
      events: [
        ev("a.md", "embed", "settled"),
        ev("b.md", "embed", "queued"),
        ev("b.md", "embed", "working"),
        ev("b.md", "embed", "settled"),
      ],
      expected: map([2, 2], [0, 0], [0, 0]),
    },
  ]

  const expectNoRegression = (previous: StageCounterMap, next: StageCounterMap): void => {
    for (const stage of ["embed", "classify", "regions"] as const) {
      expect(next[stage].settled).toBeGreaterThanOrEqual(previous[stage].settled)
      expect(next[stage].total).toBeGreaterThanOrEqual(previous[stage].total)
    }
  }

  it.each(cases)("$name", ({ events, expected }) => {
    const fold = createStageCounterFold()
    let previous = fold.counters()
    expect(previous).toEqual(emptyStageCounters())

    for (const event of events) {
      const next = fold.apply(event)
      expectNoRegression(previous, next)
      previous = next
    }

    expect(previous).toEqual(expected)
    expect(foldStageCounters(events)).toEqual(expected)
  })
})
