import { describe, it, expect } from "vitest"
import { createLimiter, MODEL_CALL_LIMIT } from "./limiter"

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

const deferred = (): Deferred => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const range = (n: number): number[] => [...Array(n).keys()]

describe("createLimiter", () => {
  it("caps in-flight calls at capacity, admits FIFO, completes all", async () => {
    const limiter = createLimiter(MODEL_CALL_LIMIT)
    const gates = range(25).map(deferred)
    const started: number[] = []
    let inFlight = 0
    let peak = 0

    const settled = gates.map((gate, i) =>
      limiter.run(async () => {
        started.push(i)
        inFlight++
        peak = Math.max(peak, inFlight)
        await gate.promise
        inFlight--
      })
    )

    await tick()
    expect(started).toEqual(range(10))

    gates[5].resolve()
    await tick()
    expect(started).toEqual(range(11))

    gates.forEach((gate) => gate.resolve())
    await Promise.all(settled)
    expect(peak).toBe(10)
    expect(started).toEqual(range(25))
  })

  it("releases the slot when the wrapped call rejects", async () => {
    const limiter = createLimiter(1)
    const failing = limiter.run(() => Promise.reject(new Error("boom")))
    await expect(failing).rejects.toThrow("boom")
    await expect(limiter.run(() => Promise.resolve("after"))).resolves.toBe("after")
  })
})
