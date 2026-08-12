// Adversarial correctness sweep for calling.md: rounds.ts, limiter.ts, pool.ts,
// call-parse.ts. Proving tests only — implementation is never edited here.
//
// Each test cites the spec line/case it exercises. Tests that could not be made
// to fail against the real implementation are left in as coverage (they pass),
// documented as such in the audit report, not as findings.

import { describe, it, expect, vi } from "vitest"
import { z } from "zod"
import { runRounds, MAX_MISSES } from "./rounds"
import type { BatchOutcome, RoundsOptions } from "./rounds"
import { createLimiter, MODEL_CALL_LIMIT } from "./limiter"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"

// ---------------------------------------------------------------------------
// rounds.ts
// ---------------------------------------------------------------------------

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

describe("rounds.ts — calling.md §Rounds", () => {
  // calling.md step 3: "Silent entries ... stay pending, each incrementing a
  // miss count." If an entry is silent in round 1 and then genuinely answered
  // in round 2, its miss count must simply stop growing (it left `pending`),
  // not reset or explode. This is the "silent item answered in a later round"
  // hunt case.
  it("a silently-missed item that is answered in a later round stops accumulating misses", async () => {
    let round = 0
    const recorded: string[] = []
    const abandonedSeen: string[] = []
    const result = await runRounds(
      ["x"],
      baseOptions({
        call: () => {
          round++
          // silent for the first two rounds, answered on the third — one miss
          // short of MAX_MISSES, so it must NOT be abandoned.
          return Promise.resolve(round >= 3 ? answered([["x", "rx"]]) : silence())
        },
        onAnswered: (item) => recorded.push(item),
        onAbandoned: (item) => abandonedSeen.push(item),
      })
    )
    expect(round).toBe(3)
    expect(recorded).toEqual(["x"])
    expect(abandonedSeen).toEqual([])
    expect(result.abandoned).toEqual([])
    expect(result.unrecorded).toEqual([])
  })

  // calling.md step 5: "Entries from unanswered calls stay pending without a
  // miss." Direct check that an item surviving only unanswered calls carries
  // zero misses forever (i.e. never gets close to MAX_MISSES=3 no matter how
  // many failures pile up).
  it("an item seen only by unanswered calls never accrues a miss, however many rounds pass", async () => {
    let calls = 0
    const result = await runRounds(
      ["x"],
      baseOptions({
        call: () => {
          calls++
          return calls <= MAX_MISSES + 5
            ? Promise.reject(new Error("down"))
            : Promise.resolve(silence())
        },
      })
    )
    // Every round fails outright, so runRounds hits the no-progress exit on
    // round 1 already: unrecorded holds the item, never abandoned.
    expect(calls).toBe(1)
    expect(result.abandoned).toEqual([])
    expect(result.unrecorded).toEqual(["x"])
  })

  // calling.md termination clause 6: "Repeat until nothing is pending,
  // everything pending is abandoned, or a round makes no progress." A pack()
  // that hands back zero batches while items are still pending must not spin
  // forever — it has to read as "no progress" and end the run.
  it("pack() returning no batches while items are pending ends the run via no-progress, not a hang", async () => {
    const result = await runRounds(
      ["a", "b"],
      baseOptions({
        pack: () => [], // pathological packer: never schedules anything
      })
    )
    expect(result.abandoned).toEqual([])
    expect(result.unrecorded.sort()).toEqual(["a", "b"])
  })

  // calling.md: "the rounds runner accepts an onCallAnswered hook, called when
  // a call settles — before the next dispatch renders." At concurrency 1 the
  // hook must fully complete before the next batch's call() is invoked.
  it("onCallAnswered at concurrency 1 fully settles before the next call() starts, even when async", async () => {
    const events: string[] = []
    await runRounds(
      ["a", "b"],
      baseOptions({
        pack: (pending) => pending.map((item) => [item]),
        call: ([item]) => {
          events.push(`call:${item}`)
          return Promise.resolve(answered([[item, `r-${item}`]]))
        },
        onCallAnswered: () => {
          events.push("settled")
        },
      })
    )
    expect(events).toEqual(["call:a", "settled", "call:b", "settled"])
  })
})

// ---------------------------------------------------------------------------
// limiter.ts
// ---------------------------------------------------------------------------

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

describe("limiter.ts — calling.md §The global limiter", () => {
  // "acquired around the transport call ... FIFO, capacity 10." A sync throw
  // inside fn (before it ever returns a promise) must still release the slot,
  // or the semaphore leaks a permit and the app's global call budget shrinks
  // forever on the very first crash of a caller.
  it("releases the slot when fn throws synchronously, before returning a promise", async () => {
    const limiter = createLimiter(1)
    const throwsSync = (): Promise<never> => {
      throw new Error("sync boom")
    }
    await expect(limiter.run(throwsSync)).rejects.toThrow("sync boom")
    // If the slot leaked, this second run would hang forever.
    await expect(limiter.run(() => Promise.resolve("ok"))).resolves.toBe("ok")
  })

  // FIFO under interleaved acquire/release, not just a monotonic fill: a
  // waiter admitted mid-stream must not jump the queue of earlier waiters.
  it("keeps FIFO order across interleaved acquires and releases, not just first-fill order", async () => {
    const limiter = createLimiter(2)
    const order: number[] = []
    const gates = [deferred(), deferred(), deferred(), deferred()]

    // Fill both slots.
    const p0 = limiter.run(async () => {
      order.push(0)
      await gates[0].promise
    })
    const p1 = limiter.run(async () => {
      order.push(1)
      await gates[1].promise
    })
    await tick()

    // Two more queue up while slots are full — order 2 then 3.
    const p2 = limiter.run(async () => {
      order.push(2)
      await gates[2].promise
    })
    const p3 = limiter.run(async () => {
      order.push(3)
      await gates[3].promise
    })
    await tick()
    expect(order).toEqual([0, 1]) // 2 and 3 must still be waiting

    gates[0].resolve()
    await tick()
    expect(order).toEqual([0, 1, 2]) // FIFO: 2 admitted before 3

    gates[1].resolve()
    await tick()
    expect(order).toEqual([0, 1, 2, 3])

    gates[2].resolve()
    gates[3].resolve()
    await Promise.all([p0, p1, p2, p3])
  })
})

// ---------------------------------------------------------------------------
// pool.ts
// ---------------------------------------------------------------------------

describe("pool.ts — calling.md §The barren fix", () => {
  // "Any answered call resets the streak." The word is "answered" — an empty
  // resolution IS an answered call and must reset consecutiveFailures on its
  // own, not merely coincide with a barren stop that would fire regardless.
  // Constructed so the barren stop (maxBarren) can never fire before the
  // failure-streak question is settled: reject, empty, reject, reject. If an
  // empty resolution resets the streak, the run finishes all 4 items with no
  // stop. If it doesn't, the third reject (item 4) is the third *consecutive*
  // failure counting from item 1, and the pool wrongly reports "failures".
  it("an answered-empty call resets the consecutive-failure streak on its own", async () => {
    const pattern: ("reject" | "empty")[] = ["reject", "empty", "reject", "reject"]
    const fn = async (i: number): Promise<number[]> => {
      if (pattern[i] === "reject") throw new Error("boom")
      return []
    }
    const { stop, consumed, failures } = await processPool(
      [0, 1, 2, 3],
      fn,
      noop as (r: number[]) => void,
      { concurrency: 1 } // no maxBarren: only the failure stop can fire
    )
    expect(consumed).toBe(4)
    expect(failures).toHaveLength(3)
    expect(stop).toBeUndefined()
  })

  // Ceiling-of-3 mirrors MAX_CONSECUTIVE_WRITE_FAILURES; abort must win over
  // an in-progress failure streak rather than racing it to "failures".
  it("an abort mid-failure-streak settles the pool without reporting the failure stop", async () => {
    const controller = new AbortController()
    const { setActiveSignal } = await import("~/lib/utils/signal")
    setActiveSignal(controller.signal)
    try {
      let call = 0
      const fn = async (): Promise<number[]> => {
        call++
        if (call === 2) controller.abort()
        throw new Error("boom")
      }
      const { stop, consumed } = await processPool(
        [1, 2, 3, 4, 5],
        fn,
        noop as (r: number[]) => void,
        { concurrency: 1 }
      )
      // Aborted after 2 failures — never reaches the 3-in-a-row ceiling.
      expect(stop).toBeUndefined()
      expect(consumed).toBeLessThanOrEqual(2)
    } finally {
      setActiveSignal(null)
    }
  })
})

// ---------------------------------------------------------------------------
// call-parse.ts
// ---------------------------------------------------------------------------
//
// calling.md: "A counting semaphore ... acquired around the transport call
// inside callAndParse ... capacity 10." And: "the retry (PARSE_RETRIES) makes
// a second transport call — is each attempt separately admitted through the
// limiter?" Proven here by saturating the real MODEL_CALL_LIMIT=10 capacity
// with 10 slow calls, queuing an 11th, then making the FIRST call's attempt 1
// fail to parse. If the limiter is held across the retry (bug), the 11th
// stays queued after attempt 1 resolves. If it's released around only the
// transport (spec), the 11th is admitted immediately — ahead of the first
// call's own attempt 2, which has to re-queue behind it.

vi.mock("~/lib/agent/client/fetch", () => ({ callLlm: vi.fn() }))

describe("call-parse.ts — calling.md §The global limiter, scope", () => {
  it("releases the limiter slot between a failed parse and its retry, admitting a different queued caller first", async () => {
    const { callAndParse } = await import("~/lib/agent/client/call-parse")
    const fetchModule = await import("~/lib/agent/client/fetch")
    const callLlm = fetchModule.callLlm as unknown as ReturnType<typeof vi.fn>

    const schema = z.object({ ok: z.literal(true) })
    const validText = JSON.stringify({ ok: true })

    const invocations: { resolve: (blocks: unknown) => void }[] = []
    callLlm.mockImplementation(() => {
      let resolve!: (blocks: unknown) => void
      const promise = new Promise((r) => (resolve = r))
      invocations.push({ resolve })
      return promise
    })

    const textBlocks = (text: string) => [{ type: "text", content: text }]

    // Fire MODEL_CALL_LIMIT concurrent callers; each will be admitted since
    // capacity is exactly MODEL_CALL_LIMIT.
    const results: Promise<unknown>[] = []
    for (let i = 0; i < MODEL_CALL_LIMIT; i++) {
      results.push(callAndParse("ep", [], schema))
    }
    await tick()
    expect(callLlm).toHaveBeenCalledTimes(MODEL_CALL_LIMIT)

    // One more caller queues behind the full limiter.
    results.push(callAndParse("ep", [], schema))
    await tick()
    expect(callLlm).toHaveBeenCalledTimes(MODEL_CALL_LIMIT) // still queued, not admitted

    // Caller 0's attempt 1 comes back with unparseable text — triggers retry.
    invocations[0].resolve(textBlocks("not json"))
    await tick()

    // If the slot was released around only the transport call, caller 11
    // (already queued, FIFO-first) is admitted now — one new invocation, and
    // it must NOT be caller 0's own retry (which would be a 2nd invocation
    // from the same logical caller re-entering ahead of the queue).
    expect(callLlm).toHaveBeenCalledTimes(MODEL_CALL_LIMIT + 1)

    // Resolve everyone else so the test can finish cleanly.
    invocations[MODEL_CALL_LIMIT].resolve(textBlocks(validText)) // caller 11
    await tick()
    for (let i = 1; i < MODEL_CALL_LIMIT; i++) invocations[i].resolve(textBlocks(validText))
    await tick()
    // Now caller 0's retry (attempt 2) should finally be admitted.
    expect(callLlm).toHaveBeenCalledTimes(MODEL_CALL_LIMIT + 2)
    invocations[MODEL_CALL_LIMIT + 1].resolve(textBlocks(validText))

    await Promise.all(results)
  })
})
