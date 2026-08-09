import type { Meta, StoryObj } from "@storybook/react-vite"
import { Progress } from "./Progress"

const meta: Meta<typeof Progress> = {
  title: "Custom/Primitives/Progress",
  component: Progress,
  decorators: [
    (Story) => (
      <div style={{ width: 240 }}>
        <Story />
      </div>
    ),
  ],
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
