import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { Sparkles } from "lucide-react"
import { ActionBarButton } from "./FloatingActionBar"

const meta: Meta<typeof ActionBarButton> = {
  title: "Custom/Primitives/ActionBarButton",
  component: ActionBarButton,
  args: { icon: <Sparkles />, label: "Ask Nabu", onClick: fn() },
}

export default meta
type Story = StoryObj<typeof ActionBarButton>

export const Default: Story = {}

export const Ai: Story = {
  args: { variant: "ai" },
}

export const Disabled: Story = {
  args: { disabled: true },
}
