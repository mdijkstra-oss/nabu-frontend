import type { Meta, StoryObj } from "@storybook/react-vite"
import { withSize } from "../../../.storybook/decorators"
import { WelcomeBackLoading } from "./WelcomeBackLoading"

const meta: Meta<typeof WelcomeBackLoading> = {
  title: "Custom/Primitives/WelcomeBackLoading",
  component: WelcomeBackLoading,
  decorators: [withSize({ height: "480px" })],
}

export default meta
type Story = StoryObj<typeof WelcomeBackLoading>

export const MidProgress: Story = {
  args: { progress: 60, statusLabel: "Loading documents..." },
}
