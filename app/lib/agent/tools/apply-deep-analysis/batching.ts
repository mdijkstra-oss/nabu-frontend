import type { Envelope } from "./envelope"

export const ENVELOPES_PER_CALL = 20
export const MAX_CODES_PER_MIXED_CALL = 3

export const groupByCode = (envelopes: readonly Envelope[]): Map<string, Envelope[]> => {
  const out = new Map<string, Envelope[]>()
  for (const e of envelopes) {
    const list = out.get(e.code) ?? []
    list.push(e)
    out.set(e.code, list)
  }
  return out
}

const chunkOf = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface LeftoverBucket {
  code: string
  envelopes: Envelope[]
}

const packLeftovers = (buckets: LeftoverBucket[], cap: number, maxCodes: number): Envelope[][] => {
  const sorted = [...buckets].sort((a, b) => b.envelopes.length - a.envelopes.length)
  const batches: Envelope[][] = []
  let current: Envelope[] = []
  let codesInCurrent = 0

  for (const bucket of sorted) {
    const wouldOverflow =
      current.length + bucket.envelopes.length > cap || codesInCurrent + 1 > maxCodes
    if (wouldOverflow && current.length > 0) {
      batches.push(current)
      current = []
      codesInCurrent = 0
    }
    current.push(...bucket.envelopes)
    codesInCurrent++
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export const planBatches = (
  envelopes: readonly Envelope[],
  cap: number = ENVELOPES_PER_CALL,
  maxCodes: number = MAX_CODES_PER_MIXED_CALL
): Envelope[][] => {
  if (envelopes.length === 0) return []
  const grouped = groupByCode(envelopes)
  const singleCodeBatches: Envelope[][] = []
  const leftovers: LeftoverBucket[] = []

  for (const [code, list] of grouped) {
    if (list.length >= cap) {
      for (const chunk of chunkOf(list, cap)) singleCodeBatches.push(chunk)
    } else {
      leftovers.push({ code, envelopes: list })
    }
  }

  const mixedBatches = packLeftovers(leftovers, cap, maxCodes)
  return [...singleCodeBatches, ...mixedBatches]
}
