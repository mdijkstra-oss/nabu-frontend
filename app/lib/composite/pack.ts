export interface Segment {
  path: string
  startLine: number
  endLine: number
  content: string
}

export interface PackedSegment {
  path: string
  startLine: number
  endLine: number
  charStart: number
  charEnd: number
}

export interface Composite {
  content: string
  segments: PackedSegment[]
}

const groupByPath = (segments: Segment[]): Map<string, Segment[]> => {
  const map = new Map<string, Segment[]>()
  for (const seg of segments) {
    const group = map.get(seg.path) ?? []
    group.push(seg)
    map.set(seg.path, group)
  }
  return map
}

export const sortSegments = (segments: Segment[]): Segment[] => {
  const grouped = groupByPath(segments)
  const sortedPaths = [...grouped.keys()].sort()
  return sortedPaths.flatMap((path) => {
    const group = grouped.get(path)
    if (!group) return []
    return group.slice().sort((a, b) => a.startLine - b.startLine)
  })
}

export const packComposites = (
  segments: Segment[],
  maxChars: number,
  separator: (seg: Segment) => string
): Composite[] => {
  if (segments.length === 0) return []

  const composites: Composite[] = []
  let parts: string[] = []
  let packed: PackedSegment[] = []
  let cursor = 0

  const seal = () => {
    if (packed.length === 0) return
    composites.push({ content: parts.join(""), segments: packed })
    parts = []
    packed = []
    cursor = 0
  }

  for (const seg of segments) {
    const sep = packed.length > 0 ? separator(seg) : ""
    const addition = sep + seg.content
    const wouldExceed = cursor > 0 && cursor + addition.length > maxChars

    if (wouldExceed) {
      seal()
    }

    const sep2 = packed.length > 0 ? separator(seg) : ""
    const charStart = cursor + sep2.length
    const charEnd = charStart + seg.content.length

    parts.push(sep2 + seg.content)
    packed.push({
      path: seg.path,
      startLine: seg.startLine,
      endLine: seg.endLine,
      charStart,
      charEnd,
    })
    cursor = charEnd
  }

  seal()
  return composites
}

export const resolveSegmentByChar = (
  composite: Composite,
  charOffset: number
): PackedSegment | undefined =>
  composite.segments.find((s) => charOffset >= s.charStart && charOffset < s.charEnd)
