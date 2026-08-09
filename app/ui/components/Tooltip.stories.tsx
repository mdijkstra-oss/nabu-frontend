import type { Meta, StoryObj } from "@storybook/react-vite"
import { Tooltip } from "./Tooltip"

const meta: Meta<typeof Tooltip> = {
  title: "Custom/Primitives/Tooltip",
  component: Tooltip,
}

export default meta
type Story = StoryObj<typeof Tooltip>

export const Static: Story = {
  args: { children: "Open the document" },
}
