import type { Meta, StoryObj } from "@storybook/react-vite"
import { withSize } from "../../../.storybook/decorators"
import { AnimatedListItem } from "./AnimatedListItem"

const meta: Meta<typeof AnimatedListItem> = {
  title: "Custom/Primitives/AnimatedListItem",
  component: AnimatedListItem,
  args: {
    children: (
      <div className="rounded-md border border-solid border-neutral-border px-3 py-2 text-body font-body">
        Entering item
      </div>
    ),
  },
  decorators: [withSize({ width: "280px" })],
}

export default meta
type Story = StoryObj<typeof AnimatedListItem>

export const Entering: Story = {}

export const WithoutLayoutAnimation: Story = {
  args: { layout: false },
}
