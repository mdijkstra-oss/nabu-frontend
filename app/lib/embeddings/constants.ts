import { CHARS_PER_TOKEN } from "~/lib/text/constants"

export const CHUNK_TOKENS = 250
export const CHUNK_OVERLAP_RATIO = 0.2
export const EMBEDDING_SYNC_DEBOUNCE = 5000
export const MAX_BATCH_TOKENS = 200_000
export const PROVIDER_BATCH_LIMIT = 512

export const CHUNK_CHARS = CHUNK_TOKENS * CHARS_PER_TOKEN
export const CHUNK_STRIDE_CHARS = Math.floor(CHUNK_CHARS * (1 - CHUNK_OVERLAP_RATIO))
export const CHUNK_WORD_TOLERANCE = Math.floor(CHUNK_CHARS * 0.1)

export const MAX_EMBEDDING_BATCH_SIZE = Math.min(
  PROVIDER_BATCH_LIMIT,
  Math.floor(MAX_BATCH_TOKENS / CHUNK_TOKENS)
)
