import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import { LayoutToggle } from "./LayoutToggle"

const meta: Meta<typeof LayoutToggle> = {
  title: "Custom/Search/LayoutToggle",
  component: LayoutToggle,
  args: {
    onChange: fn(),
  },
}

export default meta
type Story = StoryObj<typeof LayoutToggle>

export const Stacked: Story = {
  args: {
    mode: "stacked",
  },
}

export const Flat: Story = {
  args: {
    mode: "flat",
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Stacked view" }))
    expect(args.onChange).toHaveBeenCalledWith("stacked")
  },
}
