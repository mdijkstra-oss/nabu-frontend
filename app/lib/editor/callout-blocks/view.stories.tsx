import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { withSize } from "../../../../.storybook/decorators"
import { callout } from "./fixtures"
import { CalloutBlockView } from "./view"

const data = callout("blue")

const meta: Meta<typeof CalloutBlockView> = {
  title: "Custom/Editor/CalloutBlockView",
  component: CalloutBlockView,
  decorators: [withSize({ width: "520px" })],
}

export default meta
type Story = StoryObj<typeof CalloutBlockView>

export const Editable: Story = {
  args: { data, onDelete: fn(), readOnly: false },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const block = canvasElement.querySelector<HTMLElement>(".group\\/callout")
    if (!block) throw new Error("callout block not rendered")

    await userEvent.hover(block)
    const deleteButton = canvas.getByRole("button")
    expect(deleteButton).toBeInTheDocument()

    await userEvent.click(deleteButton)
    expect(args.onDelete).toHaveBeenCalledOnce()
  },
}

export const ReadOnly: Story = {
  args: { data, onDelete: fn(), readOnly: true },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole("button")).toBeNull()
  },
}
