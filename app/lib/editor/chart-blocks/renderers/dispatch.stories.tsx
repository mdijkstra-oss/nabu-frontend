import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"
import { allChartTypes, chartFixture, sampleTooltipContext } from "~/lib/chart/test-helpers"
import { ChartRenderer } from "./dispatch"

const meta: Meta<typeof ChartRenderer> = {
  title: "Custom/Charts/ChartRenderer",
  component: ChartRenderer,
}

export default meta
type Story = StoryObj<typeof ChartRenderer>

const ChartTypeGallery = () => (
  <div className="flex flex-col gap-4">
    {allChartTypes.map((type) => (
      <div key={type} data-chart-type={type} style={{ width: 640 }}>
        <ChartRenderer
          renderable={chartFixture(type).renderable}
          tooltipContext={sampleTooltipContext()}
        />
      </div>
    ))}
  </div>
)

export const Gallery: Story = {
  render: () => <ChartTypeGallery />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const axisCharts = canvasElement.querySelectorAll(
        "[data-chart-type] .recharts-cartesian-grid"
      )
      expect(axisCharts).toHaveLength(6)
      expect(
        canvasElement.querySelectorAll('[data-chart-type="pie"] .recharts-pie-sector').length
      ).toBeGreaterThan(0)
      expect(canvasElement.querySelector('[data-chart-type="treemap"] svg')).not.toBeNull()
      expect(within(canvasElement).getByText("Too cold for heatmap")).toBeInTheDocument()
    })
  },
}
