import type { Meta, StoryObj } from "@storybook/react-vite"
import { withSize } from "../../../.storybook/decorators"
import { Progress } from "./Progress"

const meta: Meta<typeof Progress> = {
  title: "Custom/Primitives/Progress",
  component: Progress,
  decorators: [withSize({ width: "240px" })],
}

export default meta
type Story = StoryObj<typeof Progress>

export const Empty: Story = {
  args: { value: 0 },
}

export const Mid: Story = {
  args: { value: 45 },
}

export const Full: Story = {
  args: { value: 100 },
}
