import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"
import { chartFixture, sampleTooltipContext } from "~/lib/chart/test-helpers"
import type { AxisRenderable, ChartType } from "~/lib/chart/types"
import { withSize } from "../../../../../.storybook/decorators"
import { AxisChart } from "./AxisChart"

const meta: Meta<typeof AxisChart> = {
  title: "Custom/Charts/AxisChart",
  component: AxisChart,
  decorators: [withSize({ width: "640px", height: "360px" })],
}

export default meta
type Story = StoryObj<typeof AxisChart>

const axisRenderable = (type: ChartType): AxisRenderable => {
  const renderable = chartFixture(type).renderable
  if (renderable.kind !== "axis") {
    throw new Error(`${type} fixture resolved to a non-axis renderable`)
  }
  return renderable
}

const bar = axisRenderable("bar")

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
    expect(getLaidOutChartHeight(canvasElement)).toBe(300)
  },
}

export const StackedBar: Story = {
  args: {
    renderable: axisRenderable("stacked-bar"),
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
    renderable: axisRenderable("grouped-bar"),
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
    renderable: axisRenderable("line"),
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
    renderable: axisRenderable("area"),
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-area-area")).toHaveLength(2)
    })
  },
}

export const Scatter: Story = {
  args: {
    renderable: axisRenderable("scatter"),
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
