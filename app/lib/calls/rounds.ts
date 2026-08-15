// The requeue loop for sites whose silence is recorded durably. Sits above the
// pool because the pool walks a fixed list and cannot take new items mid-run.

import { getActiveSignal } from "~/lib/utils/signal"

// An unanswered call answers none of its entries: none recorded, none counted
// toward a miss, all eligible for a later call. Within an answered call a
// missing key is a silent entry — ignored, one miss.
export type BatchOutcome<T, R> =
  | { answered: true; results: Map<T, R> }
  | { answered: false; error: string }

export const MAX_MISSES = 3

export interface RoundsOptions<T, R> {
  pack: (pending: T[]) => T[][]
  // Renders at dispatch, not at pack time, so a hook's updates reach every
  // later call in the same round.
  call: (batch: T[]) => Promise<BatchOutcome<T, R>>
  // Miss counts key on this, so a content change resets them.
  identityOf: (item: T) => string
  concurrency: number
  onAnswered: (item: T, result: R) => void
  onAbandoned?: (item: T) => void
  // Fires when a call settles, before the next dispatch renders; the person
  // vocabulary rides on it.
  onCallAnswered?: () => void
}

export interface RoundsResult<T> {
  abandoned: T[]
  // Pending entries left by the no-progress exit: a round in which no call was
  // answered ends the run, and these stay unrecorded for the next tick.
  unrecorded: T[]
}

export const runRounds = async <T, R>(
  items: T[],
  options: RoundsOptions<T, R>
): Promise<RoundsResult<T>> => {
  const { pack, call, identityOf, concurrency, onAnswered, onAbandoned, onCallAnswered } = options
  const signal = getActiveSignal()
  const isAborted = (): boolean => signal?.aborted === true

  const pending = new Set<T>(items)
  const misses = new Map<string, number>()
  const abandoned: T[] = []

  const abandon = (item: T) => {
    pending.delete(item)
    abandoned.push(item)
    onAbandoned?.(item)
  }

  const recordMiss = (item: T) => {
    const key = identityOf(item)
    const count = (misses.get(key) ?? 0) + 1
    misses.set(key, count)
    if (count >= MAX_MISSES) abandon(item)
  }

  const settleAnswered = (batch: T[], results: Map<T, R>) => {
    for (const item of batch) {
      if (results.has(item)) {
        pending.delete(item)
        onAnswered(item, results.get(item) as R)
      } else {
        recordMiss(item)
      }
    }
    onCallAnswered?.()
  }

  const runRound = async (batches: T[][]): Promise<boolean> => {
    let cursor = 0
    let anyAnswered = false

    const work = async (): Promise<void> => {
      while (cursor < batches.length && !isAborted()) {
        const batch = batches[cursor++]
        const outcome = await call(batch).catch(
          (error: unknown): BatchOutcome<T, R> => ({ answered: false, error: String(error) })
        )
        if (outcome.answered) {
          anyAnswered = true
          settleAnswered(batch, outcome.results)
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, work))
    return anyAnswered
  }

  while (pending.size > 0 && !isAborted()) {
    const anyAnswered = await runRound(pack([...pending]))
    if (isAborted()) return { abandoned, unrecorded: [] }
    if (!anyAnswered) return { abandoned, unrecorded: [...pending] }
  }

  return { abandoned, unrecorded: [] }
}
