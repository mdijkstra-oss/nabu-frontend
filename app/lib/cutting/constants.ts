import { CHUNK_CHARS, CHUNK_OVERLAP_RATIO } from "~/lib/embeddings/constants"

// The token budget that gives this number lives in the embedding constants, so the target
// is taken from there rather than restated. Every other bound below moves with it.
export const UNIT_TARGET_CHARS = CHUNK_CHARS

export const UNIT_FLOOR_CHARS = UNIT_TARGET_CHARS / 2
export const UNIT_CEILING_CHARS = UNIT_TARGET_CHARS * 2

// Wide enough that a repeated short sentence is not self-similar, narrow enough that an
// edit's blast radius stays small.
export const BOUNDARY_WINDOW_CHARS = 200

export const maskOfBits = (bits: number): number => (1 << bits) - 1

// Two bits: one gap in four fires. Measured over the sample corpus this closes 91% of
// units on content against 79% at three bits, and leaves one ceiling close in sixty-five
// rather than six in fifty-two. A ceiling close is the positional boundary this feature
// exists to remove, and buying fewer of them is worth a mean a fifth under target.
export const BOUNDARY_MASK_BITS = 2

export const BOUNDARY_MASK = maskOfBits(BOUNDARY_MASK_BITS)

export const OVERLAP_CHARS = Math.floor(UNIT_TARGET_CHARS * CHUNK_OVERLAP_RATIO)
