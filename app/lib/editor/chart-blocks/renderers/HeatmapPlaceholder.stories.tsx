import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import { HeatmapPlaceholder } from "./HeatmapPlaceholder"

const meta: Meta<typeof HeatmapPlaceholder> = {
  title: "Custom/Charts/HeatmapPlaceholder",
  component: HeatmapPlaceholder,
}

export default meta
type Story = StoryObj<typeof HeatmapPlaceholder>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const placeholder = within(canvasElement).getByText("Too cold for heatmap")
    expect(placeholder.getBoundingClientRect().height).toBe(300)
  },
}
