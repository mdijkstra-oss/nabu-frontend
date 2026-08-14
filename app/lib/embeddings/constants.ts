import { CHARS_PER_TOKEN } from "~/lib/text/constants"

export const CHUNK_TOKENS = 250
export const CHUNK_OVERLAP_RATIO = 0.2
export const MAX_BATCH_TOKENS = 200_000
export const PROVIDER_BATCH_LIMIT = 512

export const CHUNK_CHARS = CHUNK_TOKENS * CHARS_PER_TOKEN

// The same token budget in the unit this repository counts in, so a batch can be closed
// on what the chunks actually hold rather than on an assumed size per chunk.
export const MAX_BATCH_CHARS = MAX_BATCH_TOKENS * CHARS_PER_TOKEN
