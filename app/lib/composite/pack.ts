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

type SeparatorFn = (seg: Segment) => string

const SMALL_COMPOSITE_RATIO = 0.3

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

const segmentAddition = (seg: Segment, isFirst: boolean, sepFn: SeparatorFn): number =>
  (isFirst ? 0 : sepFn(seg).length) + seg.content.length

const groupSize = (group: Segment[], sepFn: SeparatorFn): number =>
  group.reduce((sum, seg, i) => sum + segmentAddition(seg, i === 0, sepFn), 0)

const greedyGroup = (segments: Segment[], maxChars: number, sepFn: SeparatorFn): Segment[][] => {
  const groups: Segment[][] = []
  let current: Segment[] = []
  let cursor = 0

  for (const seg of segments) {
    const addition = segmentAddition(seg, current.length === 0, sepFn)
    if (cursor > 0 && cursor + addition > maxChars) {
      groups.push(current)
      current = [seg]
      cursor = seg.content.length
      continue
    }
    current.push(seg)
    cursor += addition
  }
  if (current.length > 0) groups.push(current)
  return groups
}

interface MergeOption {
  index: number
  resultingSize: number
}

const pickMergeTarget = (
  groups: Segment[][],
  i: number,
  sepFn: SeparatorFn
): MergeOption | null => {
  const cur = groups[i]
  const prev = i > 0 ? groups[i - 1] : null
  const next = i < groups.length - 1 ? groups[i + 1] : null

  const prevOpt: MergeOption | null = prev
    ? { index: i - 1, resultingSize: groupSize([...prev, ...cur], sepFn) }
    : null
  const nextOpt: MergeOption | null = next
    ? { index: i + 1, resultingSize: groupSize([...cur, ...next], sepFn) }
    : null

  if (prevOpt && nextOpt) {
    return prevOpt.resultingSize <= nextOpt.resultingSize ? prevOpt : nextOpt
  }
  return prevOpt ?? nextOpt
}

const mergeSmallComposites = (
  groups: Segment[][],
  maxChars: number,
  sepFn: SeparatorFn
): Segment[][] => {
  const threshold = maxChars * SMALL_COMPOSITE_RATIO
  const result = [...groups]

  while (result.length > 1) {
    const smallIdx = result.findIndex((g) => groupSize(g, sepFn) < threshold)
    if (smallIdx < 0) break

    const target = pickMergeTarget(result, smallIdx, sepFn)
    if (!target) break

    if (target.index < smallIdx) {
      result[target.index] = [...result[target.index], ...result[smallIdx]]
    } else {
      result[target.index] = [...result[smallIdx], ...result[target.index]]
    }
    result.splice(smallIdx, 1)
  }

  return result
}

const buildComposite = (group: Segment[], sepFn: SeparatorFn): Composite => {
  const parts: string[] = []
  const packed: PackedSegment[] = []
  let cursor = 0

  for (const seg of group) {
    const sep = packed.length > 0 ? sepFn(seg) : ""
    const charStart = cursor + sep.length
    const charEnd = charStart + seg.content.length
    parts.push(sep + seg.content)
    packed.push({
      path: seg.path,
      startLine: seg.startLine,
      endLine: seg.endLine,
      charStart,
      charEnd,
    })
    cursor = charEnd
  }

  return { content: parts.join(""), segments: packed }
}

export const packComposites = (
  segments: Segment[],
  maxChars: number,
  separator: SeparatorFn
): Composite[] => {
  if (segments.length === 0) return []
  const groups = greedyGroup(segments, maxChars, separator)
  const balanced = mergeSmallComposites(groups, maxChars, separator)
  return balanced.map((g) => buildComposite(g, separator))
}

export const resolveSegmentByChar = (
  composite: Composite,
  charOffset: number
): PackedSegment | undefined =>
  composite.segments.find((s) => charOffset >= s.charStart && charOffset < s.charEnd)
