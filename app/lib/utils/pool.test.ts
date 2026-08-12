import { describe, it, expect } from "vitest"
import { processPool } from "./pool"
import { noop } from "./noop"

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const immediate = <T>(results: T[]): Promise<T[]> => Promise.resolve(results)

describe("processPool", () => {
  const cases: {
    name: string
    items: number[]
    fn: (item: number) => Promise<number[]>
    concurrency: number
    target?: number
    warmup?: number
    expectedMin: number
    expectedMax: number
  }[] = [
    {
      name: "processes all items without target",
      items: [1, 2, 3, 4, 5],
      fn: (n) => immediate([n * 10]),
      concurrency: 2,
      expectedMin: 5,
      expectedMax: 5,
    },
    {
      name: "empty items returns empty",
      items: [],
      fn: (n) => immediate([n]),
      concurrency: 3,
      expectedMin: 0,
      expectedMax: 0,
    },
    {
      name: "stops after reaching target",
      items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      fn: (n) => immediate([n]),
      concurrency: 1,
      target: 3,
      expectedMin: 3,
      expectedMax: 3,
    },
    {
      name: "returns fewer than target when items exhausted",
      items: [1, 2],
      fn: (n) => immediate([n]),
      concurrency: 3,
      target: 5,
      expectedMin: 2,
      expectedMax: 2,
    },
    {
      name: "skips items that return empty",
      items: [1, 0, 2, 0, 3],
      fn: (n) => immediate(n === 0 ? [] : [n]),
      concurrency: 2,
      expectedMin: 3,
      expectedMax: 3,
    },
    {
      name: "target counts only non-empty results",
      items: [0, 0, 1, 0, 2, 0, 3, 4],
      fn: (n) => immediate(n === 0 ? [] : [n]),
      concurrency: 1,
      target: 2,
      expectedMin: 2,
      expectedMax: 2,
    },
    {
      name: "flattens multi-result items",
      items: [1, 2],
      fn: (n) => immediate([n, n * 10]),
      concurrency: 2,
      expectedMin: 4,
      expectedMax: 4,
    },
    {
      name: "target with multi-result can overshoot slightly",
      items: [1, 2, 3],
      fn: (n) => immediate([n, n * 10]),
      concurrency: 1,
      target: 3,
      expectedMin: 3,
      expectedMax: 4,
    },
    {
      name: "warmup processes all items",
      items: [1, 2, 3, 4],
      fn: (n) => immediate([n]),
      concurrency: 3,
      warmup: 1,
      expectedMin: 4,
      expectedMax: 4,
    },
  ]

  it.each(cases)(
    "$name",
    async ({ items, fn, concurrency, target, warmup, expectedMin, expectedMax }) => {
      const batches: number[][] = []
      const onResults = (results: number[]) => batches.push(results)
      const { results } = await processPool(items, fn, onResults, { concurrency, target, warmup })
      expect(results.length).toBeGreaterThanOrEqual(expectedMin)
      expect(results.length).toBeLessThanOrEqual(expectedMax)
    }
  )

  const behaviorCases: { name: string; check: () => Promise<void> }[] = [
    {
      name: "respects concurrency limit",
      check: async () => {
        let peak = 0
        let active = 0
        const fn = async (n: number): Promise<number[]> => {
          active++
          peak = Math.max(peak, active)
          await delay(10)
          active--
          return [n]
        }
        await processPool([1, 2, 3, 4, 5, 6], fn, noop as (results: number[]) => void, {
          concurrency: 2,
        })
        expect(peak).toBeLessThanOrEqual(2)
      },
    },
    {
      name: "fires onResults per completed item",
      check: async () => {
        const batches: number[][] = []
        await processPool(
          [1, 2, 3],
          (n) => immediate([n]),
          (r) => batches.push(r),
          { concurrency: 1 }
        )
        expect(batches).toEqual([[1], [2], [3]])
      },
    },
    {
      name: "consumed reflects items processed with target",
      check: async () => {
        const { results, consumed } = await processPool(
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          (n) => immediate([n]),
          noop as (results: number[]) => void,
          { concurrency: 1, target: 3 }
        )
        expect(results).toHaveLength(3)
        expect(consumed).toBe(3)
      },
    },
    {
      name: "consumed equals items length without target",
      check: async () => {
        const { consumed } = await processPool(
          [1, 2, 3],
          (n) => immediate([n]),
          noop as (results: number[]) => void,
          { concurrency: 2 }
        )
        expect(consumed).toBe(3)
      },
    },
    {
      name: "warmup runs first N items serially then opens concurrency",
      check: async () => {
        const order: string[] = []
        let active = 0
        const fn = async (n: number): Promise<number[]> => {
          active++
          order.push(`start:${n}@${active}`)
          await delay(10)
          order.push(`end:${n}@${active}`)
          active--
          return [n]
        }
        await processPool([1, 2, 3, 4, 5], fn, noop as (results: number[]) => void, {
          concurrency: 3,
          warmup: 1,
        })
        expect(order[0]).toBe("start:1@1")
        expect(order[1]).toBe("end:1@1")
      },
    },
    {
      name: "continues past failed items and collects failures",
      check: async () => {
        let call = 0
        const fn = async (n: number): Promise<number[]> => {
          call++
          if (call === 2) throw new Error("boom")
          return [n]
        }
        const { results, failures } = await processPool(
          [1, 2, 3],
          fn,
          noop as (results: number[]) => void,
          { concurrency: 1 }
        )
        expect(results).toEqual([1, 3])
        expect(failures).toHaveLength(1)
        expect(failures[0].item).toBe(2)
        expect(failures[0].error).toBeInstanceOf(Error)
      },
    },
    {
      name: "all items fail — empty results, all failures collected",
      check: async () => {
        const fn = async (n: number): Promise<number[]> => {
          throw new Error(`fail-${n}`)
        }
        const { results, failures } = await processPool(
          [1, 2, 3],
          fn,
          noop as (results: number[]) => void,
          { concurrency: 2 }
        )
        expect(results).toEqual([])
        expect(failures).toHaveLength(3)
        expect(failures.map((f) => f.item).sort()).toEqual([1, 2, 3])
      },
    },
    {
      name: "only empty resolutions count barren; alternating rejections never trip the failure stop",
      check: async () => {
        const fn = async (n: number): Promise<number[]> => {
          if (n % 2 === 1) throw new Error("boom")
          return []
        }
        const { stop, barren, failures, consumed } = await processPool(
          [1, 2, 3, 4, 5, 6, 7, 8],
          fn,
          noop as (results: number[]) => void,
          { concurrency: 1, maxBarren: 2 }
        )
        expect(stop).toBe("barren")
        expect(barren).toBe(true)
        expect(failures).toHaveLength(2)
        expect(consumed).toBe(4)
      },
    },
    {
      name: "three consecutive rejections settle with the failure stop, undispatched items unconsumed",
      check: async () => {
        const fn = async (): Promise<number[]> => {
          throw new Error("down")
        }
        const { stop, barren, failures, consumed, results } = await processPool(
          [1, 2, 3, 4, 5],
          fn,
          noop as (results: number[]) => void,
          { concurrency: 1, maxBarren: 2 }
        )
        expect(stop).toBe("failures")
        expect(barren).toBe(false)
        expect(results).toEqual([])
        expect(failures).toHaveLength(3)
        expect(consumed).toBe(3)
      },
    },
    {
      name: "a resolved call resets the failure streak",
      check: async () => {
        const fn = async (n: number): Promise<number[]> => {
          if (n === 0) throw new Error("boom")
          return [n]
        }
        const { stop, failures, results, consumed } = await processPool(
          [0, 0, 1, 0, 0, 2],
          fn,
          noop as (results: number[]) => void,
          { concurrency: 1 }
        )
        expect(stop).toBeUndefined()
        expect(results).toEqual([1, 2])
        expect(failures).toHaveLength(4)
        expect(consumed).toBe(6)
      },
    },
  ]

  it.each(behaviorCases)("$name", ({ check }) => check())
})
