import { describe, it, expect } from "vitest"
import {
  magnet,
  cardOpacity,
  stepScale,
  riseAt,
  stackedPosition,
  flatPosition,
  cumulativeTop,
  reconcileAnchor,
  visibleBand,
  LAYOUT,
} from "./card-layout"

describe("magnet", () => {
  const cases: { name: string; p: number; expected: number }[] = [
    { name: "integer rests at itself", p: 3, expected: 3 },
    { name: "inside the leading rest edge snaps down", p: 2.01, expected: 2 },
    { name: "inside the trailing rest edge snaps up", p: 2.99, expected: 3 },
    { name: "midpoint is monotonic past the plateau", p: 2.5, expected: 2.5 },
  ]
  for (const c of cases) {
    it(c.name, () => expect(magnet(c.p)).toBeCloseTo(c.expected, 5))
  }
  it("is monotonic non-decreasing across a step", () => {
    let prev = -Infinity
    for (let p = 2; p <= 3.0001; p += 0.05) {
      const v = magnet(p)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
})

describe("cardOpacity", () => {
  const cases: { name: string; depth: number; expected: number }[] = [
    { name: "front is solid", depth: 0, expected: 1 },
    { name: "last full peek is solid", depth: LAYOUT.fullPeeks - 1, expected: 1 },
    {
      name: "first faded step starts dropping",
      depth: LAYOUT.fullPeeks,
      expected: 1 - 1 / (LAYOUT.openBehind - LAYOUT.fullPeeks + 1),
    },
    { name: "deepest visible fades to zero", depth: LAYOUT.openBehind, expected: 0 },
    { name: "beyond the fan clamps at zero", depth: LAYOUT.openBehind + 5, expected: 0 },
  ]
  for (const c of cases) {
    it(c.name, () => expect(cardOpacity(c.depth)).toBeCloseTo(c.expected, 5))
  }
})

describe("stackedPosition", () => {
  const center = 100
  it("front (depth 0) sits at center, full scale/opacity, locked height", () => {
    const pos = stackedPosition(0, center)
    expect(pos).toMatchObject({ y: center, scale: 1, opacity: 1, heightLocked: true })
  })
  it("falling front (depth in [-1,0]) drops below center by the fall distance", () => {
    const pos = stackedPosition(-0.5, center)
    expect(pos.y).toBeCloseTo(center + 0.5 * LAYOUT.fall, 5)
    expect(pos.opacity).toBe(1)
  })
  it("deeper card rises above center, shrinks, and fades", () => {
    const depth = LAYOUT.fullPeeks + 1
    const pos = stackedPosition(depth, center)
    expect(pos.y).toBeCloseTo(center - riseAt(depth), 5)
    expect(pos.scale).toBeCloseTo(stepScale(depth), 5)
    expect(pos.opacity).toBeLessThan(1)
    expect(pos.heightLocked).toBe(true)
  })
  it("front has the highest zIndex", () => {
    expect(stackedPosition(0, center).zIndex).toBeGreaterThan(stackedPosition(2, center).zIndex)
  })
})

describe("flatPosition + cumulativeTop", () => {
  const heights = [100, 50, 200, 75]
  const cases: { name: string; index: number; scrollTop: number; expectedY: number }[] = [
    { name: "first card at scrollTop 0", index: 0, scrollTop: 0, expectedY: 0 },
    { name: "third card stacks below the first two", index: 2, scrollTop: 0, expectedY: 150 },
    { name: "scroll shifts every card up by scrollTop", index: 2, scrollTop: 60, expectedY: 90 },
  ]
  for (const c of cases) {
    it(c.name, () => {
      const pos = flatPosition(c.index, c.scrollTop, heights)
      expect(pos.y).toBe(c.expectedY)
      expect(pos.heightLocked).toBe(false)
      expect(pos.scale).toBe(1)
    })
  }
  it("cumulativeTop sums preceding heights", () => {
    expect(cumulativeTop(heights, 3)).toBe(350)
    expect(cumulativeTop(heights, 0)).toBe(0)
  })
})

describe("reconcileAnchor", () => {
  const heights = [100, 50, 200, 75]
  it("flat target anchors the front index to its cumulative top", () => {
    expect(reconcileAnchor("flat", 2, heights)).toBe(150)
  })
  it("stacked target anchors the front index to index * STEP", () => {
    expect(reconcileAnchor("stacked", 2, heights)).toBe(2 * LAYOUT.step)
  })
  it("round-trips a front index through both modes preserving the index", () => {
    const frontIndex = 2
    const flatTop = reconcileAnchor("flat", frontIndex, heights)
    const recovered = visibleBand({
      mode: "flat",
      heights,
      scrollTop: flatTop,
      viewport: 10,
    }).current
    expect(recovered).toBe(frontIndex)
    const stackedTop = reconcileAnchor("stacked", frontIndex, heights)
    expect(stackedTop / LAYOUT.step).toBe(frontIndex)
  })
})

describe("visibleBand", () => {
  it("stacked: current is the magnet-snapped front", () => {
    const total = 9
    const band = visibleBand({ mode: "stacked", progress: 3, total })
    expect(band.current).toBe(3)
    expect(band.total).toBe(total)
  })
  it("stacked: empty total yields an empty band", () => {
    expect(visibleBand({ mode: "stacked", progress: 0, total: 0 })).toMatchObject({
      current: 0,
      total: 0,
    })
  })
  it("flat: current is the first on-screen card", () => {
    const heights = [100, 100, 100, 100, 100]
    const band = visibleBand({ mode: "flat", heights, scrollTop: 120, viewport: 250 })
    expect(band.current).toBe(1)
    expect(band.total).toBe(5)
  })
  it("flat: a short result set with everything visible starts at the first card", () => {
    const heights = [80, 80]
    const band = visibleBand({ mode: "flat", heights, scrollTop: 0, viewport: 500 })
    expect(band.current).toBe(0)
  })
})
