export interface Position {
  id: string
  top: number
  height: number
}

interface BestWindow {
  startIndex: number
  endIndex: number
}

const sortByTop = (positions: Position[]): Position[] =>
  [...positions].sort((a, b) => a.top - b.top)

const filterSelected = (positions: Position[], selectedIds: ReadonlySet<string>): Position[] =>
  positions.filter((p) => selectedIds.has(p.id))

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max))

const findBestWindow = (sorted: Position[], viewportHeight: number): BestWindow => {
  let bestStart = 0
  let bestCount = 0
  let end = 0
  for (let start = 0; start < sorted.length; start++) {
    if (end < start) end = start
    while (
      end + 1 < sorted.length &&
      sorted[end + 1].top + sorted[end + 1].height - sorted[start].top <= viewportHeight
    ) {
      end++
    }
    const count = end - start + 1
    if (count > bestCount) {
      bestCount = count
      bestStart = start
    }
  }
  return { startIndex: bestStart, endIndex: bestStart + bestCount - 1 }
}

const centerScrollTop = (
  first: Position,
  last: Position,
  viewportHeight: number,
  contentHeight: number
): number => {
  const clusterTop = first.top
  const clusterHeight = last.top + last.height - clusterTop
  const target = clusterTop - (viewportHeight - clusterHeight) / 2
  const maxScroll = Math.max(0, contentHeight - viewportHeight)
  return clamp(target, 0, maxScroll)
}

export const computeBestWindowScrollTop = (
  positions: Position[],
  selectedIds: ReadonlySet<string>,
  viewportHeight: number,
  contentHeight: number
): number | null => {
  const selected = filterSelected(positions, selectedIds)
  if (selected.length === 0) return null
  const sorted = sortByTop(selected)
  const { startIndex, endIndex } = findBestWindow(sorted, viewportHeight)
  return centerScrollTop(sorted[startIndex], sorted[endIndex], viewportHeight, contentHeight)
}
