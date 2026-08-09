import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import type { CalloutBlock } from "~/domain/data-blocks/callout/schema"
import { CalloutBlockView } from "./view"

const data: CalloutBlock = {
  id: "code-trust",
  type: "codebook-code",
  title: "Trust",
  content: "Signals of **mutual reliance** between participants.",
  color: "blue",
  collapsed: false,
}

const meta: Meta<typeof CalloutBlockView> = {
  title: "Custom/Editor/CalloutBlockView",
  component: CalloutBlockView,
  decorators: [
    (Story) => (
      <div style={{ width: 520 }}>
        <Story />
      </div>
    ),
  ],
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
