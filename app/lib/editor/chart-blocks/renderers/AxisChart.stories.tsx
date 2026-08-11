import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"
import {
  bandedChartFixture,
  renderableOfKind,
  sampleTooltipContext,
} from "~/lib/chart/test-helpers"
import { withSize } from "../../../../../.storybook/decorators"
import { AxisChart } from "./AxisChart"
import { CHART_HEIGHT } from "./shared"

const meta: Meta<typeof AxisChart> = {
  title: "Custom/Charts/AxisChart",
  component: AxisChart,
  decorators: [withSize({ width: "640px", height: "360px" })],
}

export default meta
type Story = StoryObj<typeof AxisChart>

const bar = renderableOfKind("bar", "axis")

const bandedRenderable = () => {
  const { renderable } = bandedChartFixture()
  if (renderable.kind !== "axis")
    throw new Error("banded fixture resolved to a non-axis renderable")
  return renderable
}

const getYAxisTickValues = (canvasElement: HTMLElement): number[] =>
  [...canvasElement.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick-value")]
    .map((tick) => Number(tick.textContent))
    .filter((value) => !Number.isNaN(value))

const getBarRects = (canvasElement: HTMLElement): Element[] => [
  ...canvasElement.querySelectorAll("svg .recharts-bar-rectangle"),
]

const countDistinctBarLefts = (canvasElement: HTMLElement): number =>
  new Set(getBarRects(canvasElement).map((rect) => Math.round(rect.getBoundingClientRect().left)))
    .size

const getLaidOutChartHeight = (canvasElement: HTMLElement): number => {
  const container = canvasElement.querySelector(".recharts-responsive-container")
  if (!container) throw new Error("no responsive container rendered")
  return container.getBoundingClientRect().height
}

const findRenderedBarPath = async (canvasElement: HTMLElement): Promise<SVGPathElement> =>
  await waitFor(() => {
    const path = canvasElement.querySelector<SVGPathElement>("svg .recharts-bar-rectangle path")
    if (!path) throw new Error("no bar path rendered yet")
    expect(path.getBoundingClientRect().height).toBeGreaterThan(0)
    return path
  })

export const Bar: Story = {
  args: {
    renderable: bar,
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    const path = await findRenderedBarPath(canvasElement)
    expect(getComputedStyle(path).cursor).not.toBe("pointer")
    expect(getLaidOutChartHeight(canvasElement)).toBe(CHART_HEIGHT)
  },
}

export const StackedBar: Story = {
  args: {
    renderable: renderableOfKind("stacked-bar", "axis"),
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(getBarRects(canvasElement)).toHaveLength(6)
      expect(countDistinctBarLefts(canvasElement)).toBe(3)
    })
  },
}

export const GroupedBar: Story = {
  args: {
    renderable: renderableOfKind("grouped-bar", "axis"),
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(getBarRects(canvasElement)).toHaveLength(6)
      expect(countDistinctBarLefts(canvasElement)).toBe(6)
    })
  },
}

export const VerticalBar: Story = {
  args: {
    renderable: { ...bar, orientation: "vertical" },
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const tickLabels = [
        ...canvasElement.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick-value"),
      ].map((tick) => tick.textContent)
      expect(tickLabels).toContain("Jan")
    })
  },
}

export const Line: Story = {
  args: {
    renderable: renderableOfKind("line", "axis"),
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-line-curve")).toHaveLength(2)
    })
  },
}

export const Area: Story = {
  args: {
    renderable: renderableOfKind("area", "axis"),
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-area-area")).toHaveLength(2)
      // Series peak at 14 apart and 23 summed, so a domain past 14 can only come from stacking.
      expect(Math.max(...getYAxisTickValues(canvasElement))).toBeGreaterThan(14)
    })
  },
}

export const Banded: Story = {
  args: {
    renderable: bandedRenderable(),
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-reference-area")).toHaveLength(1)
      expect(canvasElement.textContent).toContain("Polar night")
    })
  },
}

export const Scatter: Story = {
  args: {
    renderable: renderableOfKind("scatter", "axis"),
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-symbols")).toHaveLength(3)
    })
  },
}

export const DatumClick: Story = {
  args: {
    renderable: bar,
    tooltipContext: sampleTooltipContext(),
    onDatumClick: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const path = await findRenderedBarPath(canvasElement)
    expect(getComputedStyle(path).cursor).toBe("pointer")
    await userEvent.click(path)
    await waitFor(() => expect(args.onDatumClick).toHaveBeenCalledWith("/north"))
  },
}

export const ExplicitHeight: Story = {
  args: {
    renderable: bar,
    tooltipContext: sampleTooltipContext(),
    height: 220,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(getLaidOutChartHeight(canvasElement)).toBe(220)
    })
  },
}
