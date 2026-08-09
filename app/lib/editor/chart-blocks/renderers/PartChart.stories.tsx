import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"
import { chartFixture, sampleTooltipContext } from "~/lib/chart/test-helpers"
import type { ChartType, PartRenderable } from "~/lib/chart/types"
import { withSize } from "../../../../../.storybook/decorators"
import { PartChart } from "./PartChart"

const meta: Meta<typeof PartChart> = {
  title: "Custom/Charts/PartChart",
  component: PartChart,
  decorators: [withSize({ width: "640px", height: "360px" })],
}

export default meta
type Story = StoryObj<typeof PartChart>

const partRenderable = (type: ChartType): PartRenderable => {
  const renderable = chartFixture(type).renderable
  if (renderable.kind !== "part") {
    throw new Error(`${type} fixture resolved to a non-part renderable`)
  }
  return renderable
}

export const Pie: Story = {
  args: {
    renderable: partRenderable("pie"),
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-pie-sector")).toHaveLength(2)
    })
  },
}

export const TreemapChart: Story = {
  args: {
    renderable: partRenderable("treemap"),
    tooltipContext: sampleTooltipContext(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const labels = [...canvasElement.querySelectorAll("svg text")].map((el) => el.textContent)
      expect(labels).toContain("North")
      expect(labels).toContain("South")
    })
  },
}
