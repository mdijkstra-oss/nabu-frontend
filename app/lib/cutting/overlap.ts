import type { SentenceRow } from "~/lib/text/halo"
import { OVERLAP_CHARS } from "./constants"
import type { Unit } from "./units"

export interface ChunkSpan {
  unit: Unit
  chunkStart: number
  chunkEnd: number
}

// Region detection needs contiguous units so a sentence is offered to exactly one find
// call; embeddings want a concept spanning a boundary captured by a vector either side.
// Applying the overlap after cutting rather than building it into the rule serves both.
const extendedEnd = (rows: readonly SentenceRow[], unit: Unit, isLast: boolean): number => {
  if (isLast) return unit.charEnd
  const reach = unit.charEnd + OVERLAP_CHARS
  let end = unit.charEnd
  for (let index = unit.lastSentence + 1; index < rows.length; index++) {
    if (rows[index].end > reach) break
    end = rows[index].end
  }
  return end
}

export const applyOverlap = (rows: readonly SentenceRow[], units: readonly Unit[]): ChunkSpan[] =>
  units.map((unit, index) => ({
    unit,
    chunkStart: unit.charStart,
    chunkEnd: extendedEnd(rows, unit, index === units.length - 1),
  }))
