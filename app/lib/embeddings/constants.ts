import { CHARS_PER_TOKEN } from "~/lib/text/constants"

export { CHARS_PER_TOKEN } from "~/lib/text/constants"

export const TARGET_CHUNK_SIZE = 800
export const MIN_CHUNK_SIZE = 400
export const CHUNK_OVERLAP_RATIO = 0.2
export const EMBEDDING_SYNC_DEBOUNCE = 5000
export const MAX_BATCH_TOKENS = 200_000
export const PROVIDER_BATCH_LIMIT = 512

const estimatedTokensPerChunk = Math.ceil(
  (TARGET_CHUNK_SIZE * (1 + CHUNK_OVERLAP_RATIO)) / CHARS_PER_TOKEN
)
export const MAX_EMBEDDING_BATCH_SIZE = Math.min(
  PROVIDER_BATCH_LIMIT,
  Math.floor(MAX_BATCH_TOKENS / estimatedTokensPerChunk)
)
