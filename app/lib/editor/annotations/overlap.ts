import type { ResolvedAnnotation, OverlapSegment } from "./types"

interface Boundary {
  pos: number
  isStart: boolean
  index: number
  color: string
  dimmed: boolean
}

const collectBoundaries = (annotations: ResolvedAnnotation[]): Boundary[] => {
  const boundaries: Boundary[] = []

  for (const a of annotations) {
    const dimmed = a.dimmed === true
    boundaries.push({ pos: a.from, isStart: true, index: a.index, color: a.color, dimmed })
    boundaries.push({ pos: a.to, isStart: false, index: a.index, color: a.color, dimmed })
  }

  return boundaries.sort((a, b) => a.pos - b.pos)
}

const unique = <T>(items: T[]): T[] => [...new Set(items)]

interface ActiveAnnotation {
  index: number
  color: string
  dimmed: boolean
}

const toSegment = (from: number, to: number, active: ActiveAnnotation[]): OverlapSegment => {
  const segment: OverlapSegment = {
    from,
    to,
    colors: unique(active.filter((a) => !a.dimmed).map((a) => a.color)),
  }
  if (active.some((a) => a.dimmed)) segment.dimmed = true
  return segment
}

export const segmentByOverlap = (annotations: ResolvedAnnotation[]): OverlapSegment[] => {
  if (annotations.length === 0) return []

  const boundaries = collectBoundaries(annotations)
  const segments: OverlapSegment[] = []
  let active: ActiveAnnotation[] = []
  let lastPos = boundaries[0]?.pos ?? 0

  for (const boundary of boundaries) {
    if (boundary.pos > lastPos && active.length > 0) {
      segments.push(toSegment(lastPos, boundary.pos, active))
    }

    if (boundary.isStart) {
      active = [
        ...active,
        { index: boundary.index, color: boundary.color, dimmed: boundary.dimmed },
      ]
    } else {
      const idx = active.findIndex((a) => a.index === boundary.index)
      if (idx !== -1) {
        active = [...active.slice(0, idx), ...active.slice(idx + 1)]
      }
    }

    lastPos = boundary.pos
  }

  return segments
}
