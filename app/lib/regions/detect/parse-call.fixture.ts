import { respondingWith, type FakeParse, type RecordedCall } from "~/lib/calls/parse.fixture"
import type { ParseCall } from "./seam"

export { textOf, hasBreakpoint, type RecordedCall } from "~/lib/calls/parse.fixture"

export const answering = (raw: unknown): FakeParse => respondingWith(() => raw)

// One scripted answer per call, in order; a call past the script is a broken test.
export const answeringEach = (raws: unknown[]): FakeParse => {
  let served = 0
  return respondingWith(() => {
    const raw = raws[served++]
    if (raw === undefined) throw new Error(`no scripted answer for call ${served}`)
    return raw
  })
}

interface HeldCall {
  release: (raw: unknown) => void
  fail: (error: string) => void
}

// Calls resolve only when the test releases them, so dispatch order and overlap are
// observable.
export const answeringWhenReleased = (): {
  parse: ParseCall
  calls: RecordedCall[]
  held: HeldCall[]
} => {
  const calls: RecordedCall[] = []
  const held: HeldCall[] = []
  const parse: ParseCall = (endpoint, messages, schema) => {
    calls.push({ endpoint, messages })
    return new Promise((resolve) => {
      held.push({
        release: (raw: unknown) => {
          const parsed = schema.safeParse(raw)
          resolve(
            parsed.success
              ? { ok: true, data: parsed.data }
              : { ok: false, error: parsed.error.message }
          )
        },
        fail: (error: string) => resolve({ ok: false, error }),
      })
    })
  }
  return { parse, calls, held }
}

export const failing =
  (error: string): ParseCall =>
  async () => ({ ok: false, error })

export const throwing =
  (error: string): ParseCall =>
  () =>
    Promise.reject(new Error(error))
