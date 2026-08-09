import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"
import { withSize } from "../../../.storybook/decorators"
import { CheckableWrap } from "./CheckableWrap"

const rowBody = (
  <span data-testid="row-body" className="block px-1 py-1 text-body font-body">
    Interview with participant 4
  </span>
)

const meta: Meta<typeof CheckableWrap> = {
  title: "Custom/Primitives/CheckableWrap",
  component: CheckableWrap,
  args: { color: "grass", checked: false, onToggle: fn(), children: rowBody },
  decorators: [withSize({ width: "280px" })],
}

export default meta
type Story = StoryObj<typeof CheckableWrap>

export const Unchecked: Story = {}

export const Checked: Story = {
  args: { checked: true },
}

export const Partial: Story = {
  args: { partial: true },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector(".lucide-minus")).not.toBeNull())
    expect(canvasElement.querySelector(".lucide-check")).toBeNull()
  },
}

export const Muted: Story = {
  args: { checked: true, muted: true },
}

export const HoverRevealsAndToggles: Story = {
  play: async ({ args, canvas }) => {
    const checkbox = canvas.getByRole("button")
    const revealFrame = checkbox.parentElement as HTMLElement

    await waitFor(() => expect(revealFrame.getBoundingClientRect().width).toBe(0))

    await userEvent.hover(canvas.getByTestId("row-body"))
    await waitFor(() => expect(revealFrame.getBoundingClientRect().width).toBeGreaterThan(0))

    await userEvent.click(checkbox)
    expect(args.onToggle).toHaveBeenCalledOnce()
  },
}
