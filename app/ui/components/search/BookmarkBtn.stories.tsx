import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import { BookmarkBtn } from "./BookmarkBtn"

const meta: Meta<typeof BookmarkBtn> = {
  title: "Custom/Search/BookmarkBtn",
  component: BookmarkBtn,
  args: {
    onToggle: fn(),
  },
}

export default meta
type Story = StoryObj<typeof BookmarkBtn>

export const Saved: Story = {
  args: {
    saved: true,
  },
  play: async ({ args, canvas, canvasElement }) => {
    const button = canvas.getByRole("button", { name: "Remove from saved" })
    expect(canvasElement.querySelector("svg")?.getAttribute("class")).toContain("fill-current")
    await userEvent.click(button)
    expect(args.onToggle).toHaveBeenCalledOnce()
  },
}

export const Unsaved: Story = {
  args: {
    saved: false,
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("button", { name: "Save search" })).toBeInTheDocument()
    expect(canvasElement.querySelector("svg")?.getAttribute("class")).not.toContain("fill-current")
  },
}
