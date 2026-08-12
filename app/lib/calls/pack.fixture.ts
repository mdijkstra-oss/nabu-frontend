import { MAX_BATCH_CHARS, PROVIDER_BATCH_LIMIT } from "~/lib/embeddings/constants"

// A verbatim copy of the batcher the packer replaced, frozen as the equivalence
// oracle: pack under the embeddings numbers must reproduce it element for element.
export const legacyBatchBySize = <T>(items: readonly T[], sizeOf: (item: T) => number): T[][] => {
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

export const varyingSizes = (count: number): number[] =>
  Array.from({ length: count }, (_, i) => 300 + ((i * 137) % 1900))
