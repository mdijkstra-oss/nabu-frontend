import { pack } from "~/lib/calls/pack"
import { MAX_BATCH_CHARS, PROVIDER_BATCH_LIMIT } from "./constants"

export const batchBySize = <T>(items: readonly T[], sizeOf: (item: T) => number): T[][] =>
  pack(items, { sizeOf, maxChars: MAX_BATCH_CHARS, maxItems: PROVIDER_BATCH_LIMIT })
