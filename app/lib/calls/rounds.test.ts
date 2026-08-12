import { describe, it, expect, afterEach } from "vitest"
import { runRounds } from "./rounds"
import type { BatchOutcome, RoundsOptions } from "./rounds"
import { setActiveSignal } from "~/lib/utils/signal"
import { noop } from "~/lib/utils/noop"

const unanswered = (): BatchOutcome<string, string> => ({ answered: false, error: "boom" })

const answered = (entries: [string, string][]): BatchOutcome<string, string> => ({
  answered: true,
  results: new Map(entries),
})

const silence = (): BatchOutcome<string, string> => answered([])

const baseOptions = (
  overrides: Partial<RoundsOptions<string, string>>
): RoundsOptions<string, string> => ({
  pack: (pending) => [pending],
  call: () => Promise.resolve(silence()),
  identityOf: (item) => item,
  concurrency: 1,
  onAnswered: noop,
  ...overrides,
})

describe("runRounds", () => {
  afterEach(() => setActiveSignal(null))

  const cases: { name: string; check: () => Promise<void> }[] = [
    {
      name: "an unanswered call answers none: nothing recorded, no miss, run ends unrecorded",
      check: async () => {
        const calls: string[][] = []
        const recorded: string[] = []
        const abandonedSeen: string[] = []
        const result = await runRounds(
          ["a", "b", "c"],
          baseOptions({
            call: (batch) => {
              calls.push(batch)
              return Promise.resolve(unanswered())
            },
            onAnswered: (item) => recorded.push(item),
            onAbandoned: (item) => abandonedSeen.push(item),
          })
        )
        expect(calls).toEqual([["a", "b", "c"]])
        expect(recorded).toEqual([])
        expect(abandonedSeen).toEqual([])
        expect(result.abandoned).toEqual([])
        expect(result.unrecorded).toEqual(["a", "b", "c"])
      },
    },
    {
      name: "answered call naming 1 and 3 of five: those recorded, the rest miss once per silent round",
      check: async () => {
        let round = 0
        const packs: string[][] = []
        const recorded: string[] = []
        const abandonedAtRound: number[] = []
        const result = await runRounds(
          ["1", "2", "3", "4", "5"],
          baseOptions({
            pack: (pending) => {
              packs.push(pending)
              return [pending]
            },
            call: () => {
              round++
              if (round === 1)
                return Promise.resolve(
                  answered([
                    ["1", "r1"],
                    ["3", "r3"],
                  ])
                )
              return Promise.resolve(silence())
            },
            onAnswered: (item) => recorded.push(item),
            onAbandoned: () => abandonedAtRound.push(round),
          })
        )
        expect(recorded).toEqual(["1", "3"])
        expect(packs[1]).toEqual(["2", "4", "5"])
        expect(abandonedAtRound).toEqual([3, 3, 3])
        expect(result.abandoned).toEqual(["2", "4", "5"])
        expect(result.unrecorded).toEqual([])
      },
    },
    {
      name: "two misses then a third silent call: abandoned, reported, never packed again",
      check: async () => {
        const packs: string[][] = []
        const abandonedSeen: string[] = []
        const result = await runRounds(
          ["x", "y"],
          baseOptions({
            pack: (pending) => {
              packs.push(pending)
              return [pending]
            },
            call: (batch) =>
              Promise.resolve(batch.includes("y") ? answered([["y", "ry"]]) : silence()),
            onAbandoned: (item) => abandonedSeen.push(item),
          })
        )
        expect(packs).toEqual([["x", "y"], ["x"], ["x"]])
        expect(abandonedSeen).toEqual(["x"])
        expect(result.abandoned).toEqual(["x"])
        expect(result.unrecorded).toEqual([])
      },
    },
    {
      name: "failing calls give zero misses; a round answering nothing ends the run unrecorded",
      check: async () => {
        const answeredAtRound: Record<string, number> = { c1: 1, c2: 2, c3: 3 }
        let round = 0
        let failuresForX = 0
        const result = await runRounds(
          ["x", "c1", "c2", "c3"],
          baseOptions({
            pack: (pending) => {
              round++
              return pending.map((item) => [item])
            },
            call: ([item]) => {
              if (answeredAtRound[item] === round)
                return Promise.resolve(answered([[item, `r-${item}`]]))
              if (item === "x") failuresForX++
              return Promise.resolve(unanswered())
            },
          })
        )
        expect(failuresForX).toBe(4)
        expect(result.abandoned).toEqual([])
        expect(result.unrecorded).toEqual(["x"])
      },
    },
    {
      name: "unanswered entries pack together with fresh pending: one list of eight, no retry batch",
      check: async () => {
        const retried = ["r1", "r2", "r3"]
        const firstRound = ["a1", "a2", "a3", "a4", "a5"]
        const fresh = ["f1", "f2", "f3", "f4", "f5"]
        let round = 0
        const packs: string[][] = []
        const result = await runRounds(
          [...retried, ...firstRound, ...fresh],
          baseOptions({
            pack: (pending) => {
              round++
              packs.push(pending)
              return round === 1 ? [retried, firstRound] : [pending]
            },
            call: (batch) =>
              Promise.resolve(
                batch.includes("r1") && round === 1
                  ? unanswered()
                  : answered(batch.map((item): [string, string] => [item, `r-${item}`]))
              ),
          })
        )
        expect(packs[1]).toEqual([...retried, ...fresh])
        expect(result.abandoned).toEqual([])
        expect(result.unrecorded).toEqual([])
      },
    },
    {
      name: "at concurrency 1, onCallAnswered completes before the next call is invoked",
      check: async () => {
        const events: string[] = []
        await runRounds(
          ["a", "b"],
          baseOptions({
            pack: (pending) => pending.map((item) => [item]),
            call: ([item]) => {
              events.push(`call:${item}`)
              return Promise.resolve(answered([[item, `r-${item}`]]))
            },
            onCallAnswered: () => events.push("settled"),
          })
        )
        expect(events).toEqual(["call:a", "settled", "call:b", "settled"])
      },
    },
    {
      name: "abort mid-round: no new call starts, pending entries dropped",
      check: async () => {
        const controller = new AbortController()
        setActiveSignal(controller.signal)
        const calls: string[][] = []
        const result = await runRounds(
          ["a", "b", "c", "d"],
          baseOptions({
            pack: () => [
              ["a", "b"],
              ["c", "d"],
            ],
            call: (batch) => {
              calls.push(batch)
              controller.abort()
              return Promise.resolve(answered([["a", "ra"]]))
            },
          })
        )
        expect(calls).toEqual([["a", "b"]])
        expect(result.abandoned).toEqual([])
        expect(result.unrecorded).toEqual([])
      },
    },
  ]

  it.each(cases)("$name", ({ check }) => check())
})
