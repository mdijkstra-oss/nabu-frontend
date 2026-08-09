import type { Meta, StoryObj } from "@storybook/react-vite"
import { WelcomeBackLoading } from "./WelcomeBackLoading"

const meta: Meta<typeof WelcomeBackLoading> = {
  title: "Custom/Primitives/WelcomeBackLoading",
  component: WelcomeBackLoading,
  decorators: [
    (Story) => (
      <div style={{ height: 480 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof WelcomeBackLoading>

export const MidProgress: Story = {
  args: { progress: 60, statusLabel: "Loading documents..." },
}
