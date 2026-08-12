import { MAX_BATCH_CHARS, PROVIDER_BATCH_LIMIT } from "./constants"

// Chunk sizes vary, so a batch is accumulated and closed on whichever bound is reached
// first. The first item always goes in before either bound is tested, so a batch is never
// empty and an oversized item still gets a request of its own.
export const batchBySize = <T>(items: readonly T[], sizeOf: (item: T) => number): T[][] => {
  const batches: T[][] = []
  let current: T[] = []
  let chars = 0

  for (const item of items) {
    const size = sizeOf(item)
    if (
      current.length > 0 &&
      (chars + size > MAX_BATCH_CHARS || current.length >= PROVIDER_BATCH_LIMIT)
    ) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(item)
    chars += size
  }

  if (current.length > 0) batches.push(current)
  return batches
}
