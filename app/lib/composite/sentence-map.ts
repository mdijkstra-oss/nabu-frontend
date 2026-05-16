import type { Composite, PackedSegment } from "./pack"
import { resolveSegmentByChar } from "./pack"

export const buildSentenceSegmentMap = (
  composite: Composite,
  sentencePositions: { start: number }[]
): (PackedSegment | null)[] =>
  sentencePositions.map((s) => resolveSegmentByChar(composite, s.start) ?? null)

export const resolveSentenceIndex = (
  map: (PackedSegment | null)[],
  sentenceIndex: number
): PackedSegment | null => map[sentenceIndex - 1] ?? null
