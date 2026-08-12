import { CHUNK_CHARS, CHUNK_OVERLAP_RATIO } from "~/lib/embeddings/constants"

export const maskOfBits = (bits: number): number => (1 << bits) - 1

// The token budget that gives this number lives in the embedding constants, so the target
// is taken from there rather than restated.
export const UNIT_TARGET_CHARS = CHUNK_CHARS

// Two masks, and which one a gap is tested with depends only on how far it sits from the
// last cut. Below the target the strict mask fires about once in thirty-two gaps, so a
// unit rarely closes early; at or above it the loose mask fires about once in four, so a
// unit closes soon after the target and the ceiling almost never has to force it.
//
// This is what lets the floor be small. A single mask has to be loose enough to close a
// unit at all, which makes it fire several times inside every unit — and then the floor,
// not the content, picks which of those firings becomes the boundary. That choice is
// positional, and it is what carried an edit's damage down a document.
export const STRICT_MASK_BITS = 5
export const LOOSE_MASK_BITS = 2

export const STRICT_BOUNDARY_MASK = maskOfBits(STRICT_MASK_BITS)
export const LOOSE_BOUNDARY_MASK = maskOfBits(LOOSE_MASK_BITS)

// Small, because the strict mask already keeps units from closing early. It is here only
// to stop a run of very short sentences from becoming a unit each.
export const UNIT_FLOOR_CHARS = 100

export const UNIT_CEILING_CHARS = UNIT_TARGET_CHARS * 2

// Wide enough that a repeated short sentence is not self-similar, narrow enough that an
// edit's blast radius stays small.
export const BOUNDARY_WINDOW_CHARS = 200

export const OVERLAP_CHARS = Math.floor(UNIT_TARGET_CHARS * CHUNK_OVERLAP_RATIO)
