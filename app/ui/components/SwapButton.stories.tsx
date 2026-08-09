import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"
import { SwapButton } from "./SwapButton"

const meta: Meta<typeof SwapButton> = {
  title: "Custom/Primitives/SwapButton",
  component: SwapButton,
  args: {
    idle: <span>idle-node</span>,
    active: <span>active-node</span>,
    onClick: fn(),
  },
}

export default meta
type Story = StoryObj<typeof SwapButton>

export const HoverSwapsIdleForActive: Story = {
  play: async ({ canvas }) => {
    expect(canvas.getByText("idle-node")).toBeInTheDocument()
    expect(canvas.queryByText("active-node")).toBeNull()

    await userEvent.hover(canvas.getByRole("button"))
    await waitFor(() => expect(canvas.getByText("active-node")).toBeInTheDocument())
    expect(canvas.queryByText("idle-node")).toBeNull()
  },
}

export const WithActiveTooltip: Story = {
  args: { activeTooltip: "Remove from selection" },
}
