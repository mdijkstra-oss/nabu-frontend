import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"
import { chartFixture, sampleTooltipContext } from "~/lib/chart/test-helpers"
import { withSize } from "../../../../../.storybook/decorators"
import { AxisChart } from "./AxisChart"

const meta: Meta<typeof AxisChart> = {
  title: "Custom/Charts/AxisChart",
  component: AxisChart,
  decorators: [withSize({ width: "640px", height: "360px" })],
}

export default meta
type Story = StoryObj<typeof AxisChart>

const bar = chartFixture("bar").renderable
if (bar.kind !== "axis") throw new Error("bar fixture resolved to a non-axis renderable")

export const Bar: Story = {
  args: {
    renderable: bar,
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const bars = canvasElement.querySelectorAll("svg .recharts-bar-rectangle")
      expect(bars.length).toBeGreaterThan(0)
    })
  },
}
