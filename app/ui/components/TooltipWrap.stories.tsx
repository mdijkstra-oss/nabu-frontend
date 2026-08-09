import type { Meta, StoryObj } from "@storybook/react-vite"
import { TooltipWrap } from "./TooltipWrap"

const meta: Meta<typeof TooltipWrap> = {
  title: "Custom/Primitives/TooltipWrap",
  component: TooltipWrap,
  args: {
    text: "Keyboard shortcut: K",
    open: true,
    children: <button type="button">Anchor</button>,
  },
  decorators: [
    (Story) => (
      <div className="flex items-center justify-center p-16">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof TooltipWrap>

export const Top: Story = {
  args: { side: "top" },
}

export const Bottom: Story = {
  args: { side: "bottom" },
}

export const Left: Story = {
  args: { side: "left" },
}

export const Right: Story = {
  args: { side: "right" },
}
