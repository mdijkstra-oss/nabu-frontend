import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { resolveFixtureThroughSchema } from "~/lib/chart/parsed-fixtures"
import { sampleTooltipContext } from "~/lib/chart/test-helpers"
import type { AxisRenderable, AxisRow, SeriesDescriptor } from "~/lib/chart/types"
import { mustFind } from "../../../../../.storybook/dom"
import { withSize } from "../../../../../.storybook/decorators"
import { AxisChart } from "./AxisChart"
import { CHART_HEIGHT } from "./shared"

const meta: Meta<typeof AxisChart> = {
  title: "Custom/Charts/AxisChart",
  component: AxisChart,
  decorators: [withSize({ width: "640px", height: "360px" })],
  args: { tooltipContext: sampleTooltipContext() },
}

export default meta
type Story = StoryObj<typeof AxisChart>

export const Skeleton: Story = {
  render: () => (
    <AxisChart
      renderable={resolveFixtureThroughSchema("combo", "axis")}
      tooltipContext={sampleTooltipContext()}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-bar-rectangle").length).toBeGreaterThan(
        0
      )
      expect(canvasElement.querySelectorAll("svg .recharts-line-curve")).toHaveLength(1)
      expect(canvasElement.querySelectorAll(".recharts-yAxis")).toHaveLength(2)
    })
  },
}

const INDIGO = "#4f46e5"
const TEAL = "#0d9488"

const descriptor = (
  key: string,
  name: string,
  mark: SeriesDescriptor["mark"],
  overrides: Partial<SeriesDescriptor> = {}
): SeriesDescriptor => ({ key, name, mark, color: INDIGO, axis: "left", ...overrides })

const monthRows = (
  values: Record<string, [number, number, number]>,
  extra: Partial<AxisRow> = {}
): AxisRow[] =>
  ["Jan", "Feb", "Mar"].map((month, i) => ({
    x: month,
    _raw: { month },
    _colors: {},
    ...Object.fromEntries(Object.entries(values).map(([key, perMonth]) => [key, perMonth[i]])),
    ...extra,
  }))

const axisRenderable = (
  series: SeriesDescriptor[],
  rows: AxisRow[],
  overrides: Partial<Omit<AxisRenderable, "kind" | "series" | "rows">> = {}
): AxisRenderable => ({
  kind: "axis",
  orientation: "vertical",
  series,
  rows,
  bands: [],
  ...overrides,
})

const tickTexts = (axis: Element | null): string[] =>
  axis
    ? [...axis.querySelectorAll(".recharts-cartesian-axis-tick-value")].map(
        (tick) => tick.textContent ?? ""
      )
    : []

const maxTick = (axis: Element | null): number => Math.max(...tickTexts(axis).map(Number))

const yAxes = (canvasElement: HTMLElement): Element[] => [
  ...canvasElement.querySelectorAll(".recharts-yAxis"),
]

const barRects = (canvasElement: HTMLElement): Element[] => [
  ...canvasElement.querySelectorAll("svg .recharts-bar-rectangle"),
]

const barShapes = (canvasElement: HTMLElement): Element[] => [
  ...canvasElement.querySelectorAll("svg .recharts-bar-rectangle path"),
]

const distinctLefts = (elements: Element[]): number =>
  new Set(elements.map((element) => Math.round(element.getBoundingClientRect().left))).size

const symbolTops = (scatterGroup: Element): number[] =>
  [...scatterGroup.querySelectorAll(".recharts-symbols")].map((symbol) =>
    Math.round(symbol.getBoundingClientRect().top)
  )

const legendEntryTexts = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll(".nabu-chart-legend-item")].map(
    (item) => item.textContent ?? ""
  )

export const ScatterSeriesKeepOwnValues: Story = {
  args: {
    renderable: axisRenderable(
      [
        descriptor("l0s0", "Depth", "scatter"),
        descriptor("l1s0", "Spread", "scatter", { color: TEAL }),
      ],
      monthRows({ l0s0: [5, 10, 15], l1s0: [15, 5, 10] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const groups = [...canvasElement.querySelectorAll("svg .recharts-scatter")]
      expect(groups).toHaveLength(2)
      const [first, second] = groups.map(symbolTops)
      expect(first).toHaveLength(3)
      expect(second).toHaveLength(3)
      first.forEach((top, i) => expect(top).not.toBe(second[i]))
    })
  },
}

export const RightAxisClaim: Story = {
  args: {
    renderable: axisRenderable(
      [
        descriptor("l0s0", "Count", "bar"),
        descriptor("l1s0", "Ratio", "line", { color: TEAL, axis: "right" }),
      ],
      monthRows({ l0s0: [19, 23, 16], l1s0: [0.4, 0.5, 0.7] }),
      { rightAxisFormat: ".0%" }
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const axes = yAxes(canvasElement)
      expect(axes).toHaveLength(2)
      const rightTicks = tickTexts(axes[1])
      expect(rightTicks.length).toBeGreaterThan(0)
      rightTicks.forEach((tick) => expect(tick).toMatch(/%$/))
    })
  },
}

export const SingleYAxisWithoutRightClaim: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar"), descriptor("l1s0", "Ratio", "line", { color: TEAL })],
      monthRows({ l0s0: [19, 23, 16], l1s0: [4, 5, 7] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-bar-rectangle").length).toBeGreaterThan(
        0
      )
      expect(yAxes(canvasElement)).toHaveLength(1)
    })
  },
}

export const BarAndAreaStacksStayApart: Story = {
  args: {
    renderable: axisRenderable(
      [
        descriptor("l0s0", "Visits", "bar", { stackId: "bar-left" }),
        descriptor("l1s0", "Calls", "bar", { color: TEAL, stackId: "bar-left" }),
        descriptor("l2s0", "Drafts", "area", { color: "#b45309", stackId: "area-left" }),
        descriptor("l3s0", "Notes", "area", { color: "#be185d", stackId: "area-left" }),
      ],
      monthRows({
        l0s0: [10, 12, 8],
        l1s0: [20, 18, 22],
        l2s0: [5, 6, 4],
        l3s0: [10, 9, 11],
      })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(barRects(canvasElement)).toHaveLength(6)
      const domainTop = maxTick(yAxes(canvasElement)[0])
      expect(domainTop).toBeGreaterThanOrEqual(30)
      expect(domainTop).toBeLessThan(45)
    })
  },
}

export const WideFormatStackedBars: Story = {
  args: {
    renderable: axisRenderable(
      [
        descriptor("l0s0", "Visits", "bar", { stackId: "bar-left" }),
        descriptor("l1s0", "Calls", "bar", { color: TEAL, stackId: "bar-left" }),
      ],
      monthRows({ l0s0: [10, 12, 8], l1s0: [20, 18, 22] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const rects = barRects(canvasElement)
      expect(rects).toHaveLength(6)
      expect(distinctLefts(rects)).toBe(3)
    })
  },
}

export const GroupedBars: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Visits", "bar"), descriptor("l1s0", "Calls", "bar", { color: TEAL })],
      monthRows({ l0s0: [10, 12, 8], l1s0: [20, 18, 22] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const rects = barRects(canvasElement)
      expect(rects).toHaveLength(6)
      expect(distinctLefts(rects)).toBe(6)
    })
  },
}

export const StackedAreasSumDomain: Story = {
  args: {
    renderable: axisRenderable(
      [
        descriptor("l0s0", "North", "area", { stackId: "area-left" }),
        descriptor("l1s0", "South", "area", { color: TEAL, stackId: "area-left" }),
      ],
      monthRows({ l0s0: [10, 15, 20], l1s0: [5, 10, 15] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-area-area")).toHaveLength(2)
      expect(maxTick(yAxes(canvasElement)[0])).toBeGreaterThan(20)
    })
  },
}

export const OverlayAreasTopAtTallest: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "North", "area"), descriptor("l1s0", "South", "area", { color: TEAL })],
      monthRows({ l0s0: [10, 15, 20], l1s0: [5, 10, 15] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-area-area")).toHaveLength(2)
      const domainTop = maxTick(yAxes(canvasElement)[0])
      expect(domainTop).toBeGreaterThanOrEqual(20)
      expect(domainTop).toBeLessThan(35)
    })
  },
}

export const HorizontalBars: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar")],
      monthRows({ l0s0: [19, 23, 16] }),
      { orientation: "horizontal" }
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(barRects(canvasElement)).toHaveLength(3)
      const axes = yAxes(canvasElement)
      expect(axes).toHaveLength(1)
      expect(tickTexts(axes[0])).toEqual(["Jan", "Feb", "Mar"])
    })
  },
}

export const HorizontalWithLineDegradesToVertical: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar"), descriptor("l1s0", "Ratio", "line", { color: TEAL })],
      monthRows({ l0s0: [19, 23, 16], l1s0: [4, 5, 7] }),
      { orientation: "horizontal" }
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-line-curve")).toHaveLength(1)
      expect(tickTexts(canvasElement.querySelector(".recharts-xAxis"))).toEqual([
        "Jan",
        "Feb",
        "Mar",
      ])
      expect(tickTexts(yAxes(canvasElement)[0])).not.toContain("Jan")
    })
  },
}

export const HorizontalCollapsesRightClaim: Story = {
  args: {
    renderable: axisRenderable(
      [
        descriptor("l0s0", "Count", "bar"),
        descriptor("l1s0", "Ratio", "bar", { color: TEAL, axis: "right" }),
      ],
      monthRows({ l0s0: [19, 23, 16], l1s0: [4, 5, 7] }),
      { orientation: "horizontal", rightAxisFormat: ".0%" }
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(barRects(canvasElement)).toHaveLength(6)
      expect(yAxes(canvasElement)).toHaveLength(1)
      const valueTicks = tickTexts(canvasElement.querySelector(".recharts-xAxis"))
      expect(valueTicks.length).toBeGreaterThan(0)
      valueTicks.forEach((tick) => expect(tick).toMatch(/%$/))
    })
  },
}

export const AreaLegendShowsDisplayNames: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "North", "area"), descriptor("l1s0", "South", "area", { color: TEAL })],
      monthRows({ l0s0: [10, 15, 20], l1s0: [5, 10, 15] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(legendEntryTexts(canvasElement)).toEqual(["North", "South"])
    })
  },
}

export const ScatterLegendShowsDisplayNames: Story = {
  args: {
    renderable: axisRenderable(
      [
        descriptor("l0s0", "Depth", "scatter"),
        descriptor("l1s0", "Spread", "scatter", { color: TEAL }),
      ],
      monthRows({ l0s0: [5, 10, 15], l1s0: [15, 5, 10] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(legendEntryTexts(canvasElement)).toEqual(["Depth", "Spread"])
    })
  },
}

export const Banded: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar")],
      monthRows({ l0s0: [19, 23, 16] }),
      { bands: [{ from: "Feb", to: "Mar", label: "Polar night" }] }
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-reference-area")).toHaveLength(1)
      expect(within(canvasElement).getByText("Polar night")).toBeInTheDocument()
    })
  },
}

export const HorizontalBanded: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar")],
      monthRows({ l0s0: [19, 23, 16] }),
      { orientation: "horizontal", bands: [{ from: "Feb", to: "Mar", label: "Polar night" }] }
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-reference-area")).toHaveLength(1)
      expect(within(canvasElement).getByText("Polar night")).toBeInTheDocument()
    })
  },
}

export const DatumClick: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar")],
      monthRows({ l0s0: [19, 23, 16] }, { _entityUrl: "/north" })
    ),
    onDatumClick: fn(),
  },
  play: async ({ canvasElement, args }) => {
    await waitFor(() => expect(barShapes(canvasElement)).toHaveLength(3))
    const shape = barShapes(canvasElement)[0]
    expect(getComputedStyle(shape).cursor).toBe("pointer")
    await userEvent.click(shape)
    expect(args.onDatumClick).toHaveBeenCalledWith("/north")
  },
}

export const WithoutDatumClickNoPointer: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar")],
      monthRows({ l0s0: [19, 23, 16] }, { _entityUrl: "/north" })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(barShapes(canvasElement)).toHaveLength(3))
    expect(getComputedStyle(barShapes(canvasElement)[0]).cursor).not.toBe("pointer")
  },
}

export const ComboBarLine: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar"), descriptor("l1s0", "Ratio", "line", { color: TEAL })],
      monthRows({ l0s0: [19, 23, 16], l1s0: [4, 5, 7] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const surfaces = canvasElement.querySelectorAll("svg.recharts-surface")
      expect(surfaces).toHaveLength(1)
      expect(surfaces[0].querySelectorAll(".recharts-bar-rectangle")).toHaveLength(3)
      expect(surfaces[0].querySelectorAll(".recharts-line-curve")).toHaveLength(1)
      const entries = legendEntryTexts(canvasElement)
      expect(entries).toEqual(["Count", "Ratio"])
      entries.forEach((entry) => expect(entry).not.toMatch(/l\d+s\d+/))
    })
  },
}

export const SingleSeriesNoLegend: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar")],
      monthRows({ l0s0: [19, 23, 16] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(barRects(canvasElement)).toHaveLength(3))
    expect(canvasElement.querySelector(".nabu-chart-legend")).toBeNull()
  },
}

export const ExplicitHeight: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar")],
      monthRows({ l0s0: [19, 23, 16] })
    ),
    height: 180,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(mustFind(canvasElement, ".nabu-chart").getBoundingClientRect().height).toBe(180)
    })
  },
}

export const DefaultHeight: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Count", "bar")],
      monthRows({ l0s0: [19, 23, 16] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(mustFind(canvasElement, ".nabu-chart").getBoundingClientRect().height).toBe(
        CHART_HEIGHT
      )
    })
  },
}

export const ScatterGridValueLinesOnly: Story = {
  args: {
    renderable: axisRenderable(
      [descriptor("l0s0", "Depth", "scatter")],
      monthRows({ l0s0: [5, 10, 15] })
    ),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(
        canvasElement.querySelectorAll("svg .recharts-cartesian-grid-horizontal line").length
      ).toBeGreaterThan(0)
      expect(
        canvasElement.querySelectorAll("svg .recharts-cartesian-grid-vertical line")
      ).toHaveLength(0)
    })
  },
}
