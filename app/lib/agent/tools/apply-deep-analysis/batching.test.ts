import { describe, it, expect } from "vitest"
import type { Envelope } from "./envelope"
import { planBatches, groupByCode } from "./batching"

const mkEnv = (code: string, idx: number): Envelope => ({
  id: `env-${code}-${idx}`,
  code,
  file: "f.md",
  fileCharStart: 0,
  fileCharEnd: 1,
  haloSentences: ["x"],
  markedStart: 1,
  markedEnd: 1,
  markedText: "x",
  findVotes: [],
})

const mkN = (code: string, n: number): Envelope[] =>
  Array.from({ length: n }, (_, i) => mkEnv(code, i))

describe("groupByCode", () => {
  it("groups envelopes by code", () => {
    const out = groupByCode([mkEnv("a", 1), mkEnv("b", 1), mkEnv("a", 2)])
    expect(out.size).toBe(2)
    expect(out.get("a")?.length).toBe(2)
    expect(out.get("b")?.length).toBe(1)
  })
})

describe("planBatches", () => {
  it("empty input → empty plan", () => {
    expect(planBatches([])).toEqual([])
  })

  it("single code under cap → 1 batch", () => {
    const plan = planBatches(mkN("a", 5), 20, 3)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toHaveLength(5)
  })

  it("single code at cap → 1 batch", () => {
    const plan = planBatches(mkN("a", 20), 20, 3)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toHaveLength(20)
  })

  it("single code over cap → split into chunks of cap", () => {
    const plan = planBatches(mkN("a", 45), 20, 3)
    expect(plan).toHaveLength(3)
    expect(plan.map((b) => b.length)).toEqual([20, 20, 5])
    for (const batch of plan) {
      const codes = new Set(batch.map((e) => e.code))
      expect(codes.size).toBe(1)
    }
  })

  it("multiple small codes packed up to maxCodes per batch", () => {
    const plan = planBatches(
      [...mkN("a", 3), ...mkN("b", 3), ...mkN("c", 3), ...mkN("d", 3)],
      20,
      3
    )
    expect(plan).toHaveLength(2)
    const codesPerBatch = plan.map((b) => new Set(b.map((e) => e.code)).size)
    expect(codesPerBatch).toEqual([3, 1])
  })

  it("mixed packing respects envelope cap", () => {
    const plan = planBatches([...mkN("a", 8), ...mkN("b", 8), ...mkN("c", 8)], 20, 3)
    expect(plan).toHaveLength(2)
    expect(plan[0].length).toBeLessThanOrEqual(20)
    expect(plan[1].length).toBeLessThanOrEqual(20)
  })

  it("big code split + small leftovers packed", () => {
    const plan = planBatches([...mkN("big", 45), ...mkN("a", 4), ...mkN("b", 5)], 20, 3)
    const lengths = plan.map((b) => b.length).sort((a, b) => a - b)
    expect(lengths).toEqual([5, 9, 20, 20])
  })
})
