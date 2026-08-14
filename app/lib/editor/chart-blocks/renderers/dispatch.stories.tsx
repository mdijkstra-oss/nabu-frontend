import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"
import {
  allRenderableFixtureNames,
  renderableFixture,
  sampleTooltipContext,
} from "~/lib/chart/test-helpers"
import { ChartRenderer } from "./dispatch"

const meta: Meta<typeof ChartRenderer> = {
  title: "Custom/Charts/ChartRenderer",
  component: ChartRenderer,
}

export default meta
type Story = StoryObj<typeof ChartRenderer>

const ChartKindGallery = () => (
  <div className="flex flex-col gap-4">
    {allRenderableFixtureNames.map((name) => (
      <div key={name} data-chart-fixture={name} style={{ width: 640 }}>
        <ChartRenderer
          renderable={renderableFixture(name)}
          tooltipContext={sampleTooltipContext()}
        />
      </div>
    ))}
  </div>
)

export const Gallery: Story = {
  render: () => <ChartKindGallery />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const axisCharts = canvasElement.querySelectorAll(
        "[data-chart-fixture] .recharts-cartesian-grid"
      )
      expect(axisCharts).toHaveLength(4)
      expect(
        canvasElement.querySelectorAll('[data-chart-fixture="pie"] .recharts-pie-sector').length
      ).toBeGreaterThan(0)
      expect(canvasElement.querySelector('[data-chart-fixture="treemap"] svg')).not.toBeNull()
      expect(
        canvasElement.querySelectorAll('[data-chart-fixture="heatmap"] .nabu-chart-heatmap-cell')
          .length
      ).toBeGreaterThan(0)
    })
  },
}
