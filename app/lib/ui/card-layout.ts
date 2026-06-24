export type LayoutMode = "stacked" | "flat"

export interface CardPosition {
  x: number
  y: number
  scale: number
  opacity: number
  zIndex: number
  heightLocked: boolean
}

export interface VisibleBand {
  from: number
  to: number
  current: number
  total: number
}

export interface StackedParams {
  mode: "stacked"
  depth: number
  center: number
}

export interface FlatParams {
  mode: "flat"
  index: number
  scrollTop: number
  heights: number[]
}

export type LayoutParams = StackedParams | FlatParams

export interface StackedBandParams {
  mode: "stacked"
  progress: number
  cap: number
  total: number
}

export interface FlatBandParams {
  mode: "flat"
  heights: number[]
  scrollTop: number
  viewport: number
}

export type BandParams = StackedBandParams | FlatBandParams

export const LAYOUT = {
  openScale: 0.8,
  offset: 64,
  closedPeek: 2,
  openBehind: 7,
  fullPeeks: 3,
  depthShrink: 0.03,
  fall: 1400,
  step: 120,
  rest: 0.05,
} as const

export const fanSpring = { type: "spring" as const, stiffness: 280, damping: 30 }

export const stepScale = (depth: number): number => 1 - depth * LAYOUT.depthShrink

export const riseTo = (depth: number): number => {
  let rise = 0
  for (let k = 1; k <= depth; k++) rise += LAYOUT.offset * stepScale(k)
  return rise
}

export const cardOpacity = (depth: number): number =>
  depth < LAYOUT.fullPeeks
    ? 1
    : Math.max(0, 1 - (depth - LAYOUT.fullPeeks + 1) / (LAYOUT.openBehind - LAYOUT.fullPeeks + 1))

export const magnet = (p: number): number => {
  const i = Math.floor(p)
  const f = p - i
  const edge = LAYOUT.rest / 2
  if (f <= edge) return i
  if (f >= 1 - edge) return i + 1
  const t = (f - edge) / (1 - LAYOUT.rest)
  return i + t * t * (3 - 2 * t)
}

export const riseAt = (depth: number): number => {
  if (depth <= 0) return 0
  const lo = Math.floor(depth)
  return riseTo(lo) + (riseTo(lo + 1) - riseTo(lo)) * (depth - lo)
}

export const stackCap = (total: number): number => Math.min(total - 1, LAYOUT.openBehind)

export const stackCenter = (cap: number): number =>
  riseAt(Math.min(Math.max(cap, 0), LAYOUT.fullPeeks)) / 2

export const stackedPosition = (depth: number, center: number): CardPosition => {
  const zIndex = Math.round(500 - depth * 10)
  return depth <= 0
    ? { x: 0, y: center - depth * LAYOUT.fall, scale: 1, opacity: 1, zIndex, heightLocked: true }
    : {
        x: 0,
        y: center - riseAt(depth),
        scale: stepScale(depth),
        opacity: cardOpacity(depth),
        zIndex,
        heightLocked: true,
      }
}

export const cumulativeTop = (heights: number[], index: number): number => {
  let top = 0
  for (let i = 0; i < index; i++) top += heights[i] ?? 0
  return top
}

export const flatPosition = (
  index: number,
  scrollTop: number,
  heights: number[]
): CardPosition => ({
  x: 0,
  y: cumulativeTop(heights, index) - scrollTop,
  scale: 1,
  opacity: 1,
  zIndex: 0,
  heightLocked: false,
})

export const cardPosition = (params: LayoutParams): CardPosition =>
  params.mode === "stacked"
    ? stackedPosition(params.depth, params.center)
    : flatPosition(params.index, params.scrollTop, params.heights)

export const reconcileAnchor = (
  toMode: LayoutMode,
  frontIndex: number,
  heights: number[]
): number => (toMode === "flat" ? cumulativeTop(heights, frontIndex) : frontIndex * LAYOUT.step)

const emptyBand: VisibleBand = { from: 0, to: -1, current: 0, total: 0 }

const stackedBand = (progress: number, cap: number, total: number): VisibleBand => {
  if (total === 0) return emptyBand
  const p = magnet(progress)
  const from = Math.max(0, Math.ceil(p - 1))
  const to = Math.min(total - 1, Math.floor(p + cap))
  const current = Math.min(total - 1, Math.max(0, Math.round(p)))
  return { from, to, current, total }
}

const flatBand = (heights: number[], scrollTop: number, viewport: number): VisibleBand => {
  const total = heights.length
  if (total === 0) return emptyBand
  const bottom = scrollTop + viewport
  let from = -1
  let to = -1
  let top = 0
  for (let i = 0; i < total; i++) {
    const next = top + (heights[i] ?? 0)
    if (next > scrollTop && top < bottom) {
      if (from === -1) from = i
      to = i
    }
    top = next
  }
  if (from === -1) return { from: 0, to: 0, current: 0, total }
  return { from, to, current: from, total }
}

export const visibleBand = (params: BandParams): VisibleBand =>
  params.mode === "stacked"
    ? stackedBand(params.progress, params.cap, params.total)
    : flatBand(params.heights, params.scrollTop, params.viewport)
