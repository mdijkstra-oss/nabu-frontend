import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"
import { withSize } from "../../../../../.storybook/decorators"
import { SelectionBar } from "./SelectionBar"

const meta: Meta<typeof SelectionBar> = {
  title: "Custom/Sidebar/Documents/SelectionBar",
  component: SelectionBar,
  decorators: [
    withSize({ width: "240px", height: "40px", className: "group relative bg-neutral-100" }),
  ],
}

export default meta
type Story = StoryObj<typeof SelectionBar>

export const Active: Story = {
  args: {
    color: "blue",
    active: true,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const bar = canvasElement.querySelector(".opacity-100")
      expect(bar).not.toBeNull()
      expect(bar?.className).toContain("w-1")
    })
  },
}

export const CheckedNotActive: Story = {
  args: {
    color: "blue",
    active: false,
    checked: true,
  },
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector(".group")
    expect(host).not.toBeNull()
    expect(host?.childElementCount).toBe(0)
  },
}

export const Inactive: Story = {
  args: {
    color: "blue",
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const bar = canvasElement.querySelector(".opacity-0")
      expect(bar).not.toBeNull()
      expect(bar?.className).toContain("group-hover:opacity-100")
    })
  },
}
